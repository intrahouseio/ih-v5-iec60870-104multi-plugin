/**
 * iec60870-104multi index.js
 */
const util = require('util');

const app = require('./app');

(async () => {
  let plugin;
  try {
    // Получить параметры 
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi+'/index.js')();
    plugin.log('Plugin IEC60870-5-104 multi client has started.', 0);

    plugin.params.data = await plugin.params.get();
    plugin.logger.setParams(plugin.params.data);
    plugin.log('Received params data:'+util.inspect(plugin.params.data));

    // Получить каналы 
    //plugin.channels.data = await plugin.channels.get();
    
    app(plugin);
  } catch (err) {
    plugin.exit(8, `Error: ${util.inspect(err)}`);
  }
})();

function getOptFromArgs() {
  let opt;
  try {
    opt = JSON.parse(process.argv[2]); 
  } catch (e) {
    opt = {};
  }
  return opt;
}