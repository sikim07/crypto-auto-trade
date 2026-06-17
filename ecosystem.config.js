module.exports = {
  apps: [
    {
      name: "grid-bot",
      script: "dist/grid/gridBot.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-bot",
      script: "dist/arb/arbBot.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
