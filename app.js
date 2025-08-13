const util = require("util");
const { IEC104Client } = require('ih-lib60870-node');
const Scanner = require("./lib/scanner");
const sleep = ms => new Promise(resolve => (nextTimer = setTimeout(resolve, ms)));

module.exports = async function (plugin) {
  let clients = {};
  let channelsObj = {};
  let channels = await plugin.channels.get();
  const params = plugin.params.data;
  const scanner = new Scanner(plugin);
  const activationStatus = {}; // Track activation status for each client
  const activationCheckIntervals = {}; // Store intervals for periodic checks

  plugin.log('Received channels data: ' + util.inspect(channels), 2);
  channelsObj = groupByTwoMap(channels, 'nodeip', 'nodeport');
  plugin.log('Received channels data: ' + util.inspect(channelsObj, null, 4), 2);

  function sendTimeSync() {
    for (let key in channelsObj) {
      if (channelsObj[key].timesync) {
        const status = clients[key].getStatus();
        if (status.connected) {
          const success = clients[key].sendCommands([{ typeId: 103, asdu: channelsObj[key].asduAddress, ioa: 0, value: Date.now() }]);
          plugin.log(success ? "Timesync Command Success" : "Timesync Command Failed" + " ASDU " + channelsObj[key].asduAddress, 2);
        }
      }
    }
    setTimeout(sendTimeSync, params.timesynctimer * 60000 || 1800000);
  }

  setTimeout(sendTimeSync, params.timesynctimer * 60000 || 1800000);

  Object.keys(channelsObj).forEach(key => {
    activationStatus[key] = false; // Initialize activation status as false
    clients[key] = new IEC104Client((event, data) => {
      plugin.log(`Server ${key} Event: ${event}, Data: ${util.inspect(data)}`, 2);
      if (event == 'conn' && data.event === 'opened') {
        plugin.sendData([{id:channelsObj[data.clientID].connectionStatusId, value: 1}]);
        clients[data.clientID].sendStartDT();
        // Start periodic check for activation
        activationCheckIntervals[data.clientID] = setInterval(() => {
          const status = clients[data.clientID].getStatus();
          if (status.connected && !activationStatus[data.clientID]) {
            plugin.log(`Retrying sendStartDT for client ${data.clientID}`, 2);
            clients[data.clientID].sendStartDT();
          }
        }, 10000); // Retry every 10 seconds
      }
      if (event == 'conn' && data.event === 'activated') {
        activationStatus[data.clientID] = true; // Mark client as activated
        clearInterval(activationCheckIntervals[data.clientID]); // Stop periodic checks
        channelsObj[data.clientID].asduArray.forEach(asdu => {
          const success = clients[data.clientID].sendCommands([{ typeId: 100, asdu: Number(asdu), ioa: 0, value: 20 }]);
          plugin.log(success ? "Interogation Command Success" : "Interogation Command Failed" + " ASDU " + asdu, 2);
        });
      }
      if (event == 'conn' && data.event === 'closed') {
        plugin.sendData([{id:channelsObj[data.clientID].connectionStatusId, value: 0}]);
        activationStatus[data.clientID] = false; // Reset activation status on disconnect
        clearInterval(activationCheckIntervals[data.clientID]); // Stop periodic checks
      }
      if (event == 'data') {
        let sendArr = [];
        data.forEach(item => {
          if (scanner.status > 0 && scanner.clientID == item.clientID) scanner.sendData(item);
          const addrArr = channelsObj[item.clientID].objects[String(item.asdu) + "_" + String(item.ioa)];
          if (addrArr && addrArr.length > 0) {
            addrArr.forEach(addr => {
              const obj = {};
              if (addr.bit) {
                obj.value = item.val & Math.pow(2, Number(addr.offset)) ? 1 : 0;
              } else {
                obj.value = item.val;
              }
              if (item.timestamp != undefined) {
                obj.ts = item.timestamp + Number(addr.tzondevice) * (-3600000);
              } else {
                obj.ts = Date.now();
              }
              obj.id = addr.id;
              obj.chstatus = item.quality;
              obj.quality = item.quality;
              obj.title = addr.title;
              obj.parentname = addr.parentname;
              sendArr.push(obj);
            });
          }
        });
        if (sendArr.length > 0) plugin.sendData(sendArr);
      }
    });
    try {
      clients[key].connect({
        ip: channelsObj[key].nodeip,
        port: Number(channelsObj[key].nodeport),
        ipReserve: channelsObj[key].use_redundancy ? channelsObj[key].host_redundancy : "",
        asduAddress: Number(channelsObj[key].asduAddress),
        clientID: key,
        originatorAddress: Number(params.originatorAddress),
        k: Number(channelsObj[key].k),
        w: Number(channelsObj[key].w),
        t0: Number(channelsObj[key].t0),
        t1: Number(channelsObj[key].t1),
        t2: Number(channelsObj[key].t2),
        t3: Number(channelsObj[key].t3),
        reconnectDelay: 2
      });
    } catch (e) {
      plugin.log("Connection create error " + util.inspect(e), 1);
    }
  });

  plugin.onAct(async (message) => {
    plugin.log('ACT data=' + util.inspect(message.data), 1);
    const writeObj = groupByTwoMap(message.data, 'nodeip', 'nodeport');
    Object.keys(writeObj).forEach(async (key) => {
      let writeArr = [];
      const nodeipport = writeObj[key].nodeip + "_" + writeObj[key].nodeport;
      Object.keys(writeObj[key].objects).forEach(key1 => {
        writeObj[key].objects[key1].forEach(item => {
          let val;
          if (item.ioObjCtype == 45) {
            val = item.value == 1 ? true : false;
          } else {
            val = item.value;
          }
          writeArr.push({ typeId: Number(item.ioObjCtype), ioa: Number(item.objAdr), asdu: Number(item.asduAddress), value: val, bselCmd: Number(item.selCmd), ql: Number(item.ql) });
          if (item.selCmd) {
            writeArr.push({ typeId: Number(item.ioObjCtype), ioa: Number(item.objAdr), asdu: Number(item.asduAddress), value: val, bselCmd: 0, ql: Number(item.ql) });
          }
        });
      });
      try {
        for (let i = 0; i < writeArr.length; i++) {
          plugin.log("writeArr[i] " + util.inspect(writeArr[i]), 2);
          const success = clients[nodeipport].sendCommands([writeArr[i]]);
          plugin.log(success ? "Commands Success" : "Commands Failed", 2);
          await sleep(100);
        }
        writeArr = [];
      } catch (e) {
        plugin.log("Write error: " + util.inspect(e));
      }
    });
  });

  plugin.channels.onChange(async () => {
    channels = await plugin.channels.get();
    channelsObj = groupByTwoMap(channels, 'nodeip', 'nodeport');
  });

  async function terminate() {
    Object.keys(activationCheckIntervals).forEach(key => {
      clearInterval(activationCheckIntervals[key]); // Clear all periodic checks
    });
    plugin.exit();
  }

  process.on('SIGTERM', async () => {
    Object.keys(activationCheckIntervals).forEach(key => {
      clearInterval(activationCheckIntervals[key]); // Clear all periodic checks
    });
    plugin.exit();
  });

  plugin.onScan(scanObj => {
    if (!scanObj) return;
    if (scanObj.stop) {
      scanner.stop()
    } else {
      Object.keys(channelsObj).forEach(key => {
        if (channelsObj[key].parentnodefolder == scanObj.subnode) {
          scanner.request(clients[key], channelsObj[key].asduArray, key, scanObj.uuid);
        }
      });
    }
  });

 function groupByTwoMap(array, key1, key2) {
    const map = new Map();

    array.forEach(item => {
        // Формируем первичный ключ как "nodeip_nodeport"
        const primaryKey = `${item[key1] ?? 'unknown'}_${item[key2] ?? 'unknown'}`;
        const asdu = item.asduGroup ? item.asduGroupAddress : item.asduAddress;
        const secondaryKey = asdu + "_" + item.objAdr; // Вторичный ключ: asdu + objAdr

        // Если primaryKey еще не существует, создаем новую запись
        if (!map.has(primaryKey)) {
            map.set(primaryKey, {
                nodeip: item[key1],
                nodeport: item[key2],
                parentnodefolder: item.parentnodefolder,
                asduAddress: asdu,
                use_redundancy: item.use_redundancy,
                host_redundancy: item.host_redundancy,
                timesync: item.timesync,
                k: item.k,
                w: item.w,
                t0: item.t0,
                t1: item.t1,
                t2: item.t2,
                t3: item.t3,
                connectionStatusId: item.syschan ? item.id : "", // Устанавливаем id, если syschan: true
                asduArray: new Set(),
                objects: new Map()
            });
        } else if (item.syschan) {
            // Если syschan: true, обновляем connectionStatusId, если оно еще не установлено или пустое
            const group = map.get(primaryKey);
            if (!group.connectionStatusId && item.id) {
                group.connectionStatusId = item.id;
            }
        }

        // Добавляем данные в asduArray и objects только для элементов с syschan: false
        if (!item.syschan) {
            const group = map.get(primaryKey);
            group.asduArray.add(asdu);
            if (!group.objects.has(secondaryKey)) {
                group.objects.set(secondaryKey, []);
            }
            group.objects.get(secondaryKey).push(item);
        }
    });

    // Преобразуем Map в объект
    return Object.fromEntries(
        Array.from(map.entries()).map(([k1, v1]) => [
            k1,
            {
                nodeip: v1.nodeip,
                nodeport: v1.nodeport,
                parentnodefolder: v1.parentnodefolder,
                asduAddress: v1.asduAddress,
                use_redundancy: v1.use_redundancy,
                host_redundancy: v1.host_redundancy,
                timesync: v1.timesync,
                k: v1.k,
                w: v1.w,
                t0: v1.t0,
                t1: v1.t1,
                t2: v1.t2,
                t3: v1.t3,
                connectionStatusId: v1.connectionStatusId,
                asduArray: Array.from(v1.asduArray),
                objects: Object.fromEntries(v1.objects)
            }
        ])
    );
}
};