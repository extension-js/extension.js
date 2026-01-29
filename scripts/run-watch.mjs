import spawn from "cross-spawn";

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

const run = async () => {
  const env = {
    ...process.env,
    EXTENSION_DEV_NO_BROWSER: "1",
  };

  const compileCode = await runCommand("pnpm", ["run", "compile"], { env });
  if (compileCode !== 0) {
    return compileCode;
  }

  return runCommand(
    "dotenv",
    [
      "--",
      "turbo",
      "run",
      "watch",
      "--filter",
      "./programs/*",
      "--concurrency=5",
    ],
    { env }
  );
};

try {
  const exitCode = await run();
  process.exit(exitCode);
} catch (error) {
  console.error(error);
  process.exit(1);
}
