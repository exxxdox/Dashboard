import { randomUUID, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { AppError } from '../lib/errors.js';
import { collectLocalNetworks, createLocalNetworkChecker } from '../services/model-relay/access.js';
import { findCapabilityDefinition, MCP_TOOL_NAME_PATTERN, viewCapabilityDefinition, type CapabilityDefinitionView } from '../services/model-relay/capabilities.js';
import { AppDatabase } from '../services/model-relay/database.js';
import type { Capability } from '../services/model-relay/domain.js';
import { createVisionMcpHandler } from '../services/model-relay/mcp.js';
import { testOllamaEndpoint, type ImageInput } from '../services/model-relay/ollama.js';
import { VisionService } from '../services/model-relay/service.js';

const capabilitySchema = z.object({
  // 标识就是 MCP 工具名，所以直接复用工具名规则：不合法的话 Agent 侧根本调不动。
  // 留空表示采用代码默认值；非空标识仍必须符合工具名约束。
  key: z.string().trim().refine((value) => value === "" || MCP_TOOL_NAME_PATTERN.test(value), "标识即 MCP 工具名，只能用小写字母开头，后接小写字母、数字、下划线或短横线，长度 2-64").default(""),
  name: z.string().trim().max(80).default(""),
  description: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(true),
  version: z.number().int().positive().optional()
});

const endpointSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().transform(normalizeOllamaUrl),
  enabled: z.boolean().default(true)
});

const deploymentSchema = z.object({
  endpointId: z.string().uuid(),
  modelName: z.string().trim().min(1).max(160),
  supportsVision: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  enabled: z.boolean().default(true)
});

const routeSchema = z.object({
  capabilityId: z.string().uuid(),
  deploymentId: z.string().uuid(),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true)
});

const capabilityConfigurationSchema = capabilitySchema.omit({ enabled: true }).extend({
  version: z.number().int().positive(),
  routes: z.array(deploymentSchema.omit({ enabled: true }).extend({
    id: z.string().uuid().optional(),
    priority: routeSchema.shape.priority,
    enabled: routeSchema.shape.enabled
  }))
});

const runtimeSettingsSchema = z.object({
  maxImageBytes: z.number().int().min(1_024).max(50 * 1_024 * 1_024),
  maxConcurrentRequests: z.number().int().min(1).max(32),
  allowNetworkAccess: z.boolean()
});

export function normalizeOllamaUrl(value: string): string {
  const url = new URL(value);
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new AppError("Only HTTP and HTTPS are supported", 422);
  if (url.username || url.password) throw new AppError("URL must not contain credentials", 422);
  if (url.pathname !== "/" && url.pathname !== "") throw new AppError("Use the Ollama root URL", 422);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** 只读的代码侧定义与数据库行合并后返回，管理端据此展示参数等不可编辑信息。 */
function toCapabilityView(capability: Capability): Capability & { definition: CapabilityDefinitionView | null } {
  const definition = findCapabilityDefinition(capability.definitionKey);
  return { ...capability, definition: definition ? viewCapabilityDefinition(definition) : null };
}

export function registerModelRelayRoutes(app: FastifyInstance, ctx: Pick<AppContext, 'config'>): void {
  // Open only when used: unrelated dashboard requests and tests must not create a second database.
  let instance: { database: AppDatabase; service: VisionService; handler: ReturnType<typeof toNodeHandler> } | undefined;
  const runtime = () => {
    if (!instance) {
      const database = new AppDatabase(ctx.config.dataDir);
      const service = new VisionService(database);
      instance = { database, service, handler: toNodeHandler(createVisionMcpHandler(service, database)) };
    }
    return instance;
  };
  app.addHook('onClose', async () => { instance?.database.close(); });
  let interfaces: ReturnType<typeof networkInterfaces> = {};
  try { interfaces = networkInterfaces(); } catch {
    // Restricted runtimes may deny interface enumeration; keep only loopback instead of widening access.
  }
  const isLocal = createLocalNetworkChecker(collectLocalNetworks(interfaces));

  app.all('/mcp', {
    // Base64 bodies need a separate hard ceiling; ordinary dashboard APIs retain their smaller limit.
    bodyLimit: Math.ceil(50 * 1024 * 1024 * 1.4 + 64000),
    onRequest: async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
      const expected = runtime().database.getCredential('mcp').token;
      const actualBytes = Buffer.from(token);
      const expectedBytes = Buffer.from(expected);
      if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid MCP API key' } });
      }
      // Socket peer is the trust boundary; forwarded headers must never widen local access.
      if (!runtime().database.isNetworkAccessAllowed() && !isLocal(request.raw.socket.remoteAddress)) {
        return reply.code(403).send({ error: { code: 'ACCESS_DENIED', message: 'MCP access is restricted to local networks' } });
      }
    },
  }, async (request, reply) => {
    reply.hijack();
    await runtime().handler(request.raw, reply.raw, request.body);
  });

  // Encapsulation translates legacy domain errors before the dashboard's common error handler formats them.
  void app.register(async (api) => {
    api.setErrorHandler((error) => {
      if (error instanceof AppError || error instanceof z.ZodError) throw error;
      const message = error instanceof Error ? error.message : '';
      if (message === 'NOT_FOUND') throw new AppError('Record not found', 404, message);
      if (message === 'VERSION_CONFLICT') throw new AppError('Configuration changed; refresh and retry', 409, message);
      if (message === 'INVALID_CONFIGURATION') throw new AppError('Invalid capability route configuration', 422, message);
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code.includes('CONSTRAINT') || message.includes('constraint failed')) {
        throw new AppError('Record is duplicated or still referenced', 409, 'CONFLICT');
      }
      throw error;
    });
    api.get('/health', () => ({ ready: runtime().database.hasReadyRoute() }));
    api.get('/ready', (_request, reply) => {
      const ready = runtime().database.hasReadyRoute();
      return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'needs_configuration' });
    });
    api.get("/settings", (_request, reply) => reply.send(runtime().database.getRuntimeSettings()));
    api.put("/settings", (request, reply) => {
      return reply.send(runtime().database.updateRuntimeSettings(runtimeSettingsSchema.parse(request.body)));
    });

    api.get("/security", (_request, reply) => reply.send([runtime().database.getCredential("mcp")]));
    api.post<{ Params: { kind: string } }>("/security/:kind/rotate", (request, reply) => {
      const kind = z.literal("mcp").parse(request.params.kind);
      return reply.send(runtime().database.rotateCredential(kind));
    });

    // 能力集合由代码注册表决定：没有新增与删除，只允许改名称、标识、描述与启用状态。
    api.get("/capabilities", (_request, reply) => reply.send(runtime().database.listCapabilities().map(toCapabilityView)));
    api.put<{ Params: { id: string } }>("/capabilities/:id", (request, reply) => {
      const input = capabilitySchema.extend({ version: z.number().int().positive() }).parse(request.body);
      return reply.send(toCapabilityView(runtime().database.updateCapability(request.params.id!, input)));
    });
    api.patch<{ Params: { id: string } }>("/capabilities/:id/enabled", (request, reply) => {
      const input = z.object({ enabled: z.boolean(), version: z.number().int().positive() }).parse(request.body);
      return reply.send(toCapabilityView(runtime().database.updateCapabilityEnabled(request.params.id!, input)));
    });
    // 一次保存整个编辑弹窗，避免逐个请求造成能力与路由不一致。
    api.put<{ Params: { id: string } }>("/capabilities/:id/configuration", (request, reply) => {
      const input = capabilityConfigurationSchema.parse(request.body);
      return reply.send(toCapabilityView(runtime().database.updateCapabilityConfiguration(request.params.id!, input)));
    });

    // 能力测试：拿代码里的静态样例输入去打真实链路。失败也返回 200 + 诊断，
    // 因为「哪条路由、哪个模型、卡在哪一步」正是管理员点这个按钮想知道的东西。
    api.post<{ Params: { id: string } }>("/capabilities/:id/test", async (request, reply) => {
      const capability = runtime().database.listCapabilities().find((item) => item.id === request.params.id);
      if (!capability) throw new AppError("Capability not found", 404, "NOT_FOUND");
      const definition = findCapabilityDefinition(capability.definitionKey);
      if (!definition) {
        throw new AppError("Capability definition no longer exists", 404, "NO_DEFINITION");
      }
      // 样例先过一遍能力自己的入参契约：样例漂移时在这里就暴露，而不是拿坏参数去打上游。
      const input = definition.inputSchema.parse(definition.sampleInput) as ImageInput;
      return reply.send(await runtime().service.testCapability(capability.key, input, randomUUID()));
    });

    api.get("/endpoints", (_request, reply) => reply.send(runtime().database.listEndpoints()));
    api.post("/endpoints", (request, reply) => reply.code(201).send(runtime().database.createEndpoint(endpointSchema.parse(request.body))));
    // 启用状态由列表开关单独保存；旧编辑请求携带的 enabled 也不能覆盖较新的开关状态。
    api.put<{ Params: { id: string } }>("/endpoints/:id", (request, reply) => reply.send(runtime().database.updateEndpoint(request.params.id!, endpointSchema.omit({ enabled: true }).parse(request.body))));
    api.patch<{ Params: { id: string } }>("/endpoints/:id/enabled", (request, reply) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
      return reply.send(runtime().database.updateEndpointEnabled(request.params.id!, enabled));
    });
    api.delete<{ Params: { id: string } }>("/endpoints/:id", (request, reply) => {
      runtime().database.deleteEndpoint(request.params.id!);
      return reply.code(204).send();
    });
    api.post("/endpoints/test", async (request, reply) => {
      const { baseUrl } = endpointSchema.pick({ baseUrl: true }).parse(request.body);
      return reply.send(await testOllamaEndpoint(baseUrl).catch(() => { throw new AppError("Ollama connection failed", 502, "UPSTREAM_ERROR"); }));
    });

    api.get("/deployments", (_request, reply) => reply.send(runtime().database.listDeployments()));
    api.post("/deployments", (request, reply) => reply.code(201).send(runtime().database.createDeployment(deploymentSchema.parse(request.body))));
    api.put<{ Params: { id: string } }>("/deployments/:id", (request, reply) => reply.send(runtime().database.updateDeployment(request.params.id!, deploymentSchema.parse(request.body))));
    api.delete<{ Params: { id: string } }>("/deployments/:id", (request, reply) => {
      runtime().database.deleteDeployment(request.params.id!);
      return reply.code(204).send();
    });

    api.get("/routes", (_request, reply) => reply.send(runtime().database.listRoutes()));
    api.post("/routes", (request, reply) => reply.code(201).send(runtime().database.createRoute(routeSchema.parse(request.body))));
    api.put<{ Params: { id: string } }>("/routes/:id", (request, reply) => reply.send(runtime().database.updateRoute(request.params.id!, routeSchema.parse(request.body))));
    api.delete<{ Params: { id: string } }>("/routes/:id", (request, reply) => {
      runtime().database.deleteRoute(request.params.id!);
      return reply.code(204).send();
    });
  }, { prefix: "/api/model-relay" });
}
