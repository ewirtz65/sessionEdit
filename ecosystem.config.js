module.exports = {
  apps: [
    {
      name: "sessionedit-server",
      cwd: "C:\\home\\erik_\\sessionEdit\\server",
      script: "src\\server.js",
      windowsHide: true,
      watch: ["src", "public"],
      ignore_watch: ["node_modules", "uploads", "*.log"],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "mysql://root:s3cur31T@localhost:3306/transcripts"
      }
    }
  ]
};
