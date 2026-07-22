## 1. create: dir default + drop forced defaults

- [ ] 1.1 Replace the required `<project>` positional with `-d/--dir <path>` defaulting to `process.cwd()`; send it as `project` in the create body
- [ ] 1.2 Remove the commander defaults on `--agent` and `--target`; omit each field from the create body when the flag is absent (so the daemon cascade applies)
- [ ] 1.3 Keep `--prompt`, `--template`, `--target-ref`, `--run` as-is

## 2. Prefix resolution for run/rm

- [ ] 2.1 Add `resolveTaskRef(ref): Promise<string>`: `GET /tasks`, exact-id match wins, else filter `id.startsWith(ref)`; one → id, many → throw with candidate short ids, none → throw
- [ ] 2.2 `run` and `rm` resolve their argument via `resolveTaskRef` before hitting the daemon (rename the arg to `<ref>`)

## 3. list short id

- [ ] 3.1 Show the first 8 chars of the id as the leading column in `ccmux task list`

## 4. Tests

- [ ] 4.1 `create` with no `-d` sends `project = process.cwd()`; `-d <path>` sends that path (mock fetch, assert body)
- [ ] 4.2 `create` omits `agent`/`target` from the body when the flags are unset (assert absent keys)
- [ ] 4.3 `resolveTaskRef`: unique prefix → full id; ambiguous → throws listing candidates; no match → throws; exact full id short-circuits
- [ ] 4.4 `run`/`rm` resolve a prefix then hit the right endpoint (extend the existing CLI test)

## 5. Verification

- [ ] 5.1 `bun run typecheck` passes
- [ ] 5.2 `bun test` passes
- [ ] 5.3 Live smoke (isolated daemon, per prior slices): `ccmux task create --agent claude --prompt x` (no dir) creates a task for PWD; `ccmux task list` shows a short id; `ccmux task run <shortid>` runs it; a config `defaults.agent` is honored when `--agent` is omitted
