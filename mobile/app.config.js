// Reads app.json, then adds CarPlay only for builds made with CARPLAY=1.
module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  if (process.env.CARPLAY === "1") plugins.push("./plugins/withCarPlay");
  return { ...config, plugins };
};
