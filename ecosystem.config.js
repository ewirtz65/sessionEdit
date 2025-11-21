module.exports = {
  apps: [
    {
      name: "sessionedit-server",
      cwd: "C:\\home\\erik_\\sessionEdit",   // <- your repo root
      script: "npm",
      args: ["run", "start:pm2"],
      windowsHide: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
