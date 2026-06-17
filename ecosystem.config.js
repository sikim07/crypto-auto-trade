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
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      merge_logs: true,
      log_date_format: "",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
