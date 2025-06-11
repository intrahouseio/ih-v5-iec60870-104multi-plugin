/**
 * scanner.js
 *  Сканирование узлов для показа их в виде дерева
 */

const util = require('util');
const { IEC104Client } = require('ih-lib60870-node');

class Scanner {
    constructor(plugin) {
        this.plugin = plugin;
        this.status = 0; // 0 - сканирование не активно, 1 - первое дерево, 2 - дерево достраивается
        this.clientID = '';
        this.clients = new Set(); // Список uuid клиентов сканирования
    }

    start(session, arr, clientID) {
        this.status = 1;
        this.session = session;
        this.clientID = clientID;
        this.plugin.log("clientID " + this.clientID)
        this.scanArray = [
            {
                id: this.clientID,
                browseName: this.clientID,
                title: this.clientID,
                nodeClass: 1,
                parentId: ''
            }
        ];
        this.idSet = new Set();
        this.asduSet = new Set();
        // Отправка дерева первый раз, дальше досылается как add
        const data = [this.makeTree()];
        this.clients.forEach(uuid => this.sendTree(uuid, data));
        this.status = 2;

        try {
            this.scanning(arr);
            //
        } catch (e) {
            this.stop();
            this.plugin.log('ERROR ' + util.inspect(e), 2);
        }
    }

    request(session, arr, clientID, uuid) {
        // Всех подписчиков записать в список, чтобы им потом отправить дерево
        this.clients.add(uuid);

        if (this.status == 2) {
            this.sendTree(uuid); // Дерево готово - сразу отправляем
        } else {
            // Всех подписчиков записывать в список, чтобы им потом отправить дерево
            this.clients.add(uuid);

            if (this.status == 0) {
                this.start(session, arr, clientID);
            }
        }
    }

    // Процедура сканирования
    scanning(asduArr) {
        try {
            asduArr.forEach(asdu => {
                const success = this.session.sendCommands([{ typeId: 100, asdu: Number(asdu), ioa: 0, value: 20 }]);
                this.plugin.log(success ? "Interogation Command Success" : "Interogation Command Failed" + " ASDU " + asdu, 2);
            })
        } catch (e) {
            this.plugin.log('ERROR scanning ' + util.inspect(e), 2);
        }
    }

    getClientID() {
        return this.clientID;
    }
    sendData(data) {
        if (!this.asduSet.has(data.asdu)) {
            this.asduSet.add(data.asdu);
            const branch = { parentId: data.clientID, id: data.clientID + data.asdu, title: "ASDU " + data.asdu };
            this.scanArray.push(branch);
            this.sendTreePart({ ...branch, children: [] }, data.clientID);
        }
        const id = data.asdu + "_" + data.ioa;
        const title = this.getType(data.typeId) + " adr:" + data.ioa + " val:" + data.val;
        if (this.idSet.has(id)) return;
        this.idSet.add(id);
        const leaf = {
            parentId: data.clientID,
            id,
            title,
            channel: {
                //title,
                topic: title,
                chan: "Control Object " + data.asdu + " adr:" + data.ioa,
                ioObjMtype: data.typeId,
                objAdr: data.ioa,
                asduGroup: 1,
                asduGroupAddress: data.asdu,
                r: 1,
            }
        }
        this.scanArray.push(leaf);
        this.sendTreePart(leaf, data.clientID+data.asdu);
        //this.plugin.log("data " + util.inspect(data) + "clientID " + this.clientID)
    }
    // Отправка дерева клиенту uuid
    sendTree(uuid, data) {
        if (!data) data = [this.makeTree()];
        // this.plugin.log('SEND SCAN TREE for ' + uuid + ': ' + util.inspect(data, null, 7));
        this.plugin.send({ type: 'scan', op: 'list', data, uuid });
    }

    // Отправка сообщения в процессе сканирования
    // Отправить на сервер только scanid, pluginengine сам определяет uuid
    sendTreePart(data, parentid) {
        this.plugin.send({ type: 'scan', op: 'add', data, parentid, scanid: 'root' });
    }

    // Из массива this.scanArray формирует дерево
    makeTree() {
        const ids = this.scanArray.reduce((acc, el, i) => {
            acc[el.id] = i;
            return acc;
        }, {});

        let root;
        this.scanArray.forEach(el => {
            if (!el.parentId) {
                root = el;
                return;
            }
            const parentEl = this.scanArray[ids[el.parentId]];
            parentEl.children = [...(parentEl.children || []), el];
        });
        return root;
    }

    stop() {
        this.clients.clear();
        this.idSet.clear();
        this.asduSet.clear();
        this.clientID = '';
        this.status = 0;
    }
    getType(dataTypeValue) {
        switch (dataTypeValue) {
            case 1:
                return 'M_SP_NA (1)';

            case 3:
                return 'M_DP_NA (3)';

            case 5:
                return 'M_ST_NA (5)';

            case 7:
                return 'M_BO_NA (7)';

            case 9:
                return 'M_ME_NA (9)';

            case 11:
                return 'M_ME_NB (11)';

            case 13:
                return 'M_ME_NC (13)';

            case 15:
                return 'M_IT_NA (15)';

            case 30:
                return 'M_SP_TB (30)';

            case 31:
                return 'M_DP_TB(31)';

            case 32:
                return 'M_ST_TB (32)';

            case 33:
                return 'M_BO_TB (33)';

            case 34:
                return 'M_ME_TD (34)';

            case 35:
                return 'M_ME_TE (35)';

            case 36:
                return 'M_ME_TF (36)';

            case 37:
                return 'M_IT_TB (37)';
            default:
                return String(dataTypeValue);
        }
    }
}

module.exports = Scanner;