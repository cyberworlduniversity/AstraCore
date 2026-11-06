# AstraCore isolated Python worker

## Security model

This module is a fail-closed adapter for a disposable Python container. It is not enabled by default and is not a substitute for an independently reviewed production sandbox. It requires all of the following:

- A dedicated **rootless Docker daemon** on a separate sandbox host or isolated service account.
- The daemon socket mounted only for the AstraCore sandbox broker at \`/run/astracore-sandbox/docker.sock\`. Do not point it at the host's general-purpose Docker socket.
- The gVisor \`runsc\` runtime installed and registered with that daemon. There is no fallback to the default runtime.
- A Python image already present on the daemon, pinned by immutable SHA-256 digest. The image must provide \`/usr/local/bin/python3\`.
- The daemon must not share host mounts, credentials, networks, or workload containers with AstraCore's main server.

Configuration:

- \`ASTRA_SANDBOX_DOCKER_HOST=unix:///run/astracore-sandbox/docker.sock\`
- \`ASTRA_SANDBOX_IMAGE=registry.example/astracore-python@sha256:<64 lowercase hex characters>\`

The image is never pulled by a job (\`--pull=never\`). The runner does not pass model prompts, user secrets, server environment variables, credentials, host paths, or network access into the container.

## Per-job restrictions

Each job runs in a disposable container with:

- gVisor \`runsc\` runtime; no runtime fallback
- network disabled
- read-only root filesystem
- all Linux capabilities dropped
- no-new-privileges and Docker's default seccomp profile
- non-root UID/GID 65532
- 64 MiB memory and 0.25 CPU
- 16 process limit, 32 file descriptors, and 8 MiB non-executable temporary filesystem
- 5 second maximum wall-clock deadline
- 16 KiB source and combined output limits
- automatic container removal and forced kill on timeout/output overflow

The command is assembled from fixed arguments; user input is sent only on stdin as Python source. Shell execution, Docker arguments, image names, mounts, environment variables, and network settings are not user-controlled.

## Operational caveats

- A Docker daemon API is effectively privileged. Use a dedicated rootless daemon on a separate host or a narrowly scoped broker. Never expose a general host Docker socket to the application.
- gVisor reduces the kernel attack surface but is not a proof of isolation. For higher assurance, consider Kata Containers or a dedicated VM per job, plus independent security review.
- Do not mount user files or secrets into the worker. If file input is needed later, pass bounded content through stdin and validate it.
- Do not enable this tool in production until the daemon, runtime, image digest, broker identity, network policy, monitoring, and teardown behavior are independently verified.
- The current AstraCore HTTP server does not wire this worker into \`/api/tools\`; tool execution remains disabled by default. This PR provides a tested adapter contract, not a production deployment.
