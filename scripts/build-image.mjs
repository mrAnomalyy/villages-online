import { spawnSync } from "node:child_process";

const targets = {
  all: ["gateway", "realm-alpha", "web", "editor"],
  editor: ["editor"],
  gateway: ["gateway"],
  realm: ["realm-alpha"],
  web: ["web"],
};

const environment = process.argv[2];
const target = process.argv[3];

if (!["dev", "prod"].includes(environment) || !target || !Object.hasOwn(targets, target)) {
  console.error(`Usage: node scripts/build-image.mjs dev|prod ${Object.keys(targets).join("|")}`);
  process.exit(1);
}

const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (commit.status !== 0) {
  console.error(commit.stderr || "Unable to resolve current git commit.");
  process.exit(commit.status ?? 1);
}

const imageTag = (process.env.VILLAGES_IMAGE_TAG || commit.stdout.trim()).toLowerCase();
const services = targets[target];
const composeFiles =
  environment === "dev"
    ? ["-f", "docker-compose.yml", "-f", "docker-compose.dev-images.yml"]
    : ["-f", "docker-compose.prod.yml"];

console.log(`Building ${environment} image target "${target}" with tag "${imageTag}".`);

const build = spawnSync("docker", ["compose", ...composeFiles, "build", ...services], {
  env: {
    ...process.env,
    VILLAGES_IMAGE_TAG: imageTag,
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(build.status ?? 1);
