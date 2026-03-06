// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'feishu-claude-bridge',
    script: 'npx',
    args: 'tsx src/index.ts',
    cwd: __dirname,
    env_file: '.env',
    watch: false,
    max_memory_restart: '500M',
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
