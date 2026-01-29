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
  const primaryCode = await runCommand("dotenv", ["--", "turbo", "run", "compile"]);
  if (primaryCode === 0) {
    return 0;
  }

  return runCommand("pnpm", ["-r", "--filter", "./programs/*", "run", "compile"]);
};

try {
  const exitCode = await run();
  process.exit(exitCode);
} catch (error) {
  console.error(error);
  process.exit(1);
}
