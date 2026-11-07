#!/bin/sh
set -e
# Host bind mounts (TrueNAS datasets) arrive root-owned: the chown in the image
# is overwritten when the volume is mounted. Repair ownership, then drop to the
# non-root user for the server itself.
if [ "$(id -u)" = "0" ]; then
	chown -R node:node /app/data
	exec su-exec node "$@"
fi
exec "$@"
