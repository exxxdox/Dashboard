#!/bin/sh
#
# Start the dashboard as PUID:PGID, taking ownership of the mounted directories
# first if we were given the privileges to do it.
#
# Why this exists: the image chowns /data at build time, but a bind mount
# shadows that layer. The directory the app actually writes to is the one on the
# *host*, owned by whoever created it -- typically root, when Docker created it
# on first `docker compose up`. With no entrypoint the process would start as
# PUID:PGID and die immediately with `EACCES ... open '/data/secret.key'`.
#
# So compose starts this container as root, the two mount points are brought in
# line with PUID:PGID here, and the process drops to that unprivileged uid for
# the rest of its life.
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/data}"
SCRIPT_ROOT_CONTAINER="${SCRIPT_ROOT_CONTAINER:-/workspace}"

case "${PUID}" in
  '' | *[!0-9]*) echo "entrypoint: PUID must be numeric, got '${PUID}'" >&2; exit 1 ;;
esac
case "${PGID}" in
  '' | *[!0-9]*) echo "entrypoint: PGID must be numeric, got '${PGID}'" >&2; exit 1 ;;
esac

if [ "$(id -u)" != "0" ]; then
  # Started unprivileged. Nothing can be fixed from here, so say what is wrong
  # rather than letting the app fail a second later with a bare EACCES.
  if [ -d "${DATA_DIR}" ] && [ ! -w "${DATA_DIR}" ]; then
    echo "entrypoint: ${DATA_DIR} is not writable by uid $(id -u)." >&2
    echo "entrypoint: chown it to ${PUID}:${PGID}, set PUID/PGID to its owner, or remove 'user:' so this entrypoint can do it." >&2
  fi
  exec "$@"
fi

# The database and the generated key live here, and there are only ever a couple
# of files, so recursing is cheap and also repairs ownership on a second start.
chown -R "${PUID}:${PGID}" "${DATA_DIR}"

# The shared root can hold whole repositories. Only the directory itself is
# chowned: the container has to be able to create entries in it, but taking
# ownership of every file the host already put there is neither needed nor ours
# to do.
if [ -d "${SCRIPT_ROOT_CONTAINER}" ]; then
  chown "${PUID}:${PGID}" "${SCRIPT_ROOT_CONTAINER}" 2>/dev/null \
    || echo "entrypoint: could not chown ${SCRIPT_ROOT_CONTAINER}; cloning a source may fail" >&2
fi

exec setpriv --reuid "${PUID}" --regid "${PGID}" --clear-groups --inh-caps=-all "$@"
