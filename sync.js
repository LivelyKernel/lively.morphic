import { num, arr, string, obj, promise, fun } from "lively.lang";
import { morph } from "./index.js";

var i = val => obj.inspect(val, {maxDepth: 2}),
    assert = (bool, msgFn) => { if (!bool) throw new Error(msgFn()); }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// change (de)serialization
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function deserializeChangeProp(change, name, val, objectMap) {
  if (!val || val.isMorph) return val;

  if (typeof val === "string" && objectMap.has(val)) {
    console.warn(`deserializeChange: Found prop [${name}] that is a morph id but is not specified as one!`);
    return objectMap.get(val);
  }

  if (val.type === "lively-sync-morph-ref") {
    var resolved = objectMap.get(val.id);
    assert(resolved, () => `Cannot deserialize change ${i(change)}[${name}], cannot find ref ${val.id} (property ${name})`);
    return resolved;
  }

  if (val.type === "lively-sync-morph-spec") {
    var resolved = objectMap.get(val.spec._id)
    if (!resolved) {
      resolved = morph(val.spec, {restore: true});
      objectMap.set(val.spec._id, resolved);
    }
    assert(resolved, () => `Cannot deserialize change ${i(change)}[${name}], cannot create morph from spec ${val.spec}`);
    return resolved;
  }

  return val;
}

function deserializeChange(change, objectMap) {
  var deserializedChange = obj.clone(change);

  if (change.target)
    deserializedChange.target = deserializeChangeProp(change, "target", change.target, objectMap);

  if (change.type === "setter") {
    deserializedChange.value = deserializeChangeProp(change, "value", change.value, objectMap);

  } else if (change.type === "method-call") {
    deserializedChange.receiver = deserializeChangeProp(change, "receiver", change.receiver, objectMap);
    deserializedChange.args = change.args.map((arg, i) => deserializeChangeProp(change, `args[${i}]`, arg, objectMap))

  } else {
    assert(false, () => `Unknown change type ${change.type}, ${i(change)}`);
  }

  return deserializedChange;
}


function serializeChangeProp(change, name, val, objectMap, opts = {forceMorphId: false}) {
  if (!val) return val;

  if (val.isMorph) {
    if (!objectMap.has(val.id))
      objectMap.set(val.id, val);
    return opts.forceMorphId ?
      {type: "lively-sync-morph-ref", id: val.id} :
      {type: "lively-sync-morph-spec", spec: val.exportToJSON()};
  }

  return val;
}

function serializeChange(change, objectMap) {
  var serializedChange = obj.clone(change);

  if (change.target)
    serializedChange.target = serializeChangeProp(change, "target", change.target, objectMap, {forceMorphId: true});

  if (change.type === "setter") {
    serializedChange.value = serializeChangeProp(change, "value", change.value, objectMap);
  } else if (change.type === "method-call") {
    serializedChange.receiver = serializeChangeProp(change, "receiver", change.receiver, objectMap, {forceMorphId: true});
    serializedChange.args = change.args.map((arg,i) => serializeChangeProp(change, `arg[${i}]`, arg, objectMap));
  } else {
    assert(false, () => `Unknown change type ${change.type}, ${i(change)}`);
  }

  return serializedChange;
}

function applyChange(change, syncController) {
  var {world, objects} = syncController.state,
      deserializedChange = deserializeChange(change, objects),
      {type, receiver, args} = deserializedChange;

  // FIXME...! Adding unknown morphs to local registry...
  if (type === "method-call") {
    args
      .filter(ea => ea && ea.isMorph && !objects.has(ea))
      .forEach(m => objects.set(m.id, m));
  }

  deserializedChange.target.applyChange(deserializedChange);
}


function isEqualRef(objA, objB) {
  if (!objA || !objB) return false;
  if (objA === objB) return true;
  if (objA.type === "lively-sync-morph-ref" && objB.type === "lively-sync-morph-ref"
   && objA.id === objB.id) return true;
  if (objA.type === "lively-sync-morph-spec" && objB.type === "lively-sync-morph-spec"
   && objA._id === objB._id) return true;
  return false;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

// debugging helpers

function printUUID(id) {
  if (typeof id !== "string") return String(id);
  if (/^[a-z]/i.test(id)) return id.slice(0, id.indexOf("_")+6);
  return id.slice(0, 5);
}

function printObj(obj) {
  if (!obj) return String(obj);
  if (typeof obj.serializeExpr === "function") return obj.serializeExpr();
  if (obj.type === "lively-sync-morph-spec") return `<spec for ${printUUID(obj.spec._id)}>`
  if (obj.type === "lively-sync-morph-ref") return `<ref for ${printUUID(obj.id)}>`
  return lively.lang.obj.inspect(obj, {maxDepth: 1}).replace(/\n/g, "").replace(/\s\s+/g, " ");
}

function printChange(change) {
  var {type, target, value, prop, receiver, selector, args} = change;
  switch (type) {
    case 'method-call':
      return `${printUUID(receiver.id)}.${selector}(${args.map(printObj).join(",")})`;
    case 'setter':
      return `${printUUID(target.id)}.${prop} = ${printObj(value)}`;
    default:
      "?????????"
  }
}

function printOp(op) {
  var {id, parent, change} = op;
  return `${printUUID(id)} < ${printUUID(parent)} | ${printChange(change)}`
}

function printOps(ops) { return ops.map(printOp).join("\n"); }





// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// transforming ops
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function nullTransform(op1, op2) {
  // does nothing
  return {op1, op2, handled: false};
}


function runTransforms(op1, op2, tfmFns) {
  op1 = obj.clone(op1),
  op2 = obj.clone(op2);

  for (let tfmFn of tfmFns) {
    try {
      var {op1, op2, handled} = tfmFn(op1, op2);
      if (handled) break;
    } catch (e) {
      console.error(`Error while transforming ${op1} with ${op2}:\n ${e.stack || e}`);
    }
  }

  op1.parent = op2.id;
  op2.parent = op1.id;
  return {op1, op2};
}

function transformOp_1_to_n(op, againstOps, transformFns = []) {
  // transform an op against other ops
  if (!againstOps.length)
    return {transformedOp: op, transformedAgainstOps: []}

  var op2 = op, transformedAgainstOps = [];
  for (let op1 of againstOps) {
    var {op1, op2} = runTransforms(op1, op2, transformFns);
    transformedAgainstOps.push(op1);
  }
  return {transformedOp: op2, transformedAgainstOps: againstOps}
}




// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// composing ops
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function composeOps(ops) {
  return ops.length <= 1 ?
    ops :
    ops.slice(0, -1).reduceRight((composed, op1) => {
      var [op2, ...rest] = composed;
      return composeOpPair(op1, op2).concat(rest);
    }, ops.slice(-1));
}

function composeOpPair(op1, op2) {
  // composing setters: Use the last change as it overrides everything before
  if (op1.change.prop === op2.change.prop
   && isEqualRef(op1.change.target, op2.change.target)
   && op1.change.type === "setter" && op2.change.type === "setter")
     return [op2]

  return [op1, op2];
}



// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// communication channel
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
class Channel {
  
  constructor(senderRecvrA, onReceivedMethodA, senderRecvrB, onReceivedMethodB) {
    if (!senderRecvrA) throw new Error("no sender / receiver a!");
    if (!senderRecvrB) throw new Error("no sender / receiver b!");
    if (typeof senderRecvrA[onReceivedMethodA] !== "function") throw new Error(`sender a has no receive method ${onReceivedMethodA}!`);
    if (typeof senderRecvrB[onReceivedMethodB] !== "function") throw new Error(`sender b has no receive method ${onReceivedMethodB}!`);

    this.id = string.newUUID();
    this.senderRecvrA = senderRecvrA;
    this.onReceivedMethodA = onReceivedMethodA;
    this.onReceivedMethodB = onReceivedMethodB;
    this.senderRecvrB = senderRecvrB;
    this.queueAtoB = [];
    this.queueBtoA = [];
    this.delayAtoB = 0;
    this.delayBtoA = 0;
    this.online = false;
    this.debug = true;
    this.lifetime = 100;

    this.goOnline();
  }

  toString() {
    return `<channel ${this.senderRecvrA}.${this.onReceivedMethodA} – ${this.senderRecvrB}.${this.onReceivedMethodB}>`
  }

  isOnline() { return this.online; }
  goOffline() { this.online = false; }
  goOnline() { this.online = true; this.watchdogProcess(); }

  watchdogProcess() {
    if (!this.isOnline()) return;
    setTimeout(() => {
      if (this.queueAtoB.length) this.send([], this.senderRecvrA);
      else if (this.queueBtoA.length) this.send([], this.senderRecvrB);
      else return;
      this.watchdogProcess();
    }, 100 + num.random(50));
  }

  isEmpty() {
    return !this.queueBtoA.length && !this.queueAtoB.length;
  }

  waitForDelivery() {
    return Promise.all([
      this.queueAtoB.length ? this.send([], this.senderRecvrA) : Promise.resolve(),
      this.queueBtoA.length ? this.send([], this.senderRecvrB) : Promise.resolve()]);
  }

  send(content, sender) {
    if (sender !== this.senderRecvrA && sender !== this.senderRecvrB)
      throw new Error(`send called with sender unknown to channel: ${sender}`);

    var recvr = this.senderRecvrA === sender ? this.senderRecvrB : this.senderRecvrA,
        queue = this.senderRecvrA === sender ? this.queueAtoB : this.queueBtoA,
        delay = this.senderRecvrA === sender ? this.delayAtoB : this.delayBtoA,
        method = this.senderRecvrA === sender ? this.onReceivedMethodB : this.onReceivedMethodA,
        descr = this.senderRecvrA === sender ? "AtoB" : "BtoA";

    if (this.debug) {
      var msgs = (Array.isArray(content) ? content : [content]);
      let string = `${sender} -> ${recvr}:`;
      if (!msgs.length) string += " no messages"
      // else if (msgs.length === 1) string += msgs[0];
      else if (msgs.length === 1) string += i(msgs[0]);
      else string += "\n  " + msgs.join("\n  ");
      console.log(string);
    }
    
    queue.push(...(Array.isArray(content) ? content : [content]));

    this.watchdogProcess();

    // try again later...
    if (!this.isOnline()) return;


    return Promise.resolve().then(() =>
      new Promise((resolve, reject) => {
        try {
          recvr[method](queue, sender, this);
          resolve();
        } catch (e) {
          console.error(`Error in ${method} of ${recvr}: ${e.stack || e}`);
          reject(e);
        } finally { queue.length = 0; }
      })
      // new Promise((resolve, reject) =>
      //   fun.throttleNamed(`${this.id}-${descr}`, delay, () => {
      //     try {
      //       recvr[method](queue, sender, this);
      //       resolve();
      //     } catch (e) {
      //       console.error(`Error in ${method} of ${recvr}: ${e.stack || e}`);
      //       reject(e);
      //     } finally { queue.length = 0; }
      //   })())
        )
        .catch(err => {
          console.error(`Error in channel.send ${sender} -> ${recvr}: ${err}`);
          throw err;
        })
  }
}



// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// client
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
export class ClientState {

  constructor(world) {
    this.name = "some client"
    this.error = null;
    this.world = world;
    this.objects = new Map();
    world.withAllSubmorphsDo(ea => this.objects.set(ea.id, ea));
    this.history = [];
    this.pending = [];
    this.buffer = [];
    this.isApplyingChange = false;
    this.connection = {opChannel: null, metaChannel: null};
    this.metaMessageCallbacks = {};
    this.transformFunctions = [];
    this.delay = 0;
  }

}

export class Client {

  constructor(world, name = "some client") {
    this.state = new ClientState(world);
    this.state.name = name;
  }

  toString() {
    return `<sync ${this.state.name} hist:${this.history.length} buf:${this.buffer.length}>`
  }

  get error() { return this.state.error }

  get history() { return this.state.history; }
  get buffer() { return this.state.buffer; }
  printHist() { return printOps(this.history); }
  printBuffer() { return printOps(this.buffer); }

  get master() {
    var opChannel = this.state.connection.opChannel;
    return opChannel ? opChannel.senderRecvrB : null;
  }

  send(op) {
    if (!this.hasConnection())
      throw new Error(`Cannot send, not connected!`)
    return this.state.connection.opChannel.send(op, this);
  }

  sendMeta(msg) {
    if (!this.hasConnection())
      throw new Error(`Cannot send, not connected!`)
    return this.state.connection.metaChannel.send(msg, this);
  }

  sendMetaAndWait(msg) {
    return new Promise((resolve, reject) => {
      if (!this.hasConnection())
        return reject(new Error(`Cannot send, not connected!`));
      msg.id = msg.id || string.newUUID();
      this.state.metaMessageCallbacks[msg.id] =
        answer => answer.error ? reject(new Error(answer.error)) : resolve(answer);
      this.sendMeta(msg);
    });
  }

  disconnectFromMaster() {
    var con = this.state.connection, {opChannel, metaChannel} = con;
    if (!opChannel && !metaChannel) return;
    opChannel && opChannel.goOffline();
    metaChannel && metaChannel.goOffline();
    var master = (opChannel || metaChannel).senderRecvrB;
    master.removeConnection(con);
    con.metaChannel = null;
    con.opChannel = null;
  }

  connectToMaster(master) {
    this.disconnectFromMaster();
    var con = this.state.connection;
    con.opChannel = new Channel(this, "receiveOpsFromMaster", master, "receiveOpsFromClient")
    con.metaChannel = new Channel(this, "receiveMetaMsgsFromMaster", master, "receiveMetaMsgsFromClient")
    master.addConnection(con);
  }

  hasConnection() {
    var {opChannel, metaChannel} = this.state.connection;
    return !!opChannel && !!metaChannel;
  }

  isOnline() {
    var {opChannel, metaChannel} = this.state.connection;
    return this.hasConnection() && opChannel.isOnline() && metaChannel.isOnline();
  }

  goOffline() {
    var {opChannel, metaChannel} = this.state.connection;
    opChannel.goOffline();
    metaChannel.goOffline();
  }

  goOnline() {
    var {opChannel, metaChannel} = this.state.connection;
    opChannel.goOnline();
    metaChannel.goOnline();
  }

  goOfflineWithOpChannel() {
    var {opChannel} = this.state.connection;
    opChannel.goOffline();
  }

  goOnlineWithOpChannel() {
    var {opChannel} = this.state.connection;
    opChannel.goOnline();
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // "locking" – meta operation sent to everyone to prevent
  // changes while some other operation happens
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  lockEveryone() {
    return this.sendMetaAndWait({
      request: "lock",
      requester: this.state.name
    });
  }

  unlockEveryone() {
    return this.sendMetaAndWait({
      request: "unlock",
      requester: this.state.name
    });
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // processing changes from local world, creating new op
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  newChange(change) {
    if (this.state.isApplyingChange) return;

    if (this.error) {
      console.error(`sync client ecountered error, refusing to accept new change, ${this.error}`);
      return;
    }

    var parent = arr.last(this.buffer) || arr.last(this.history);
    return this.newOperation({
      parent: parent ? parent.id : null,
      id: string.newUUID(),
      creator: this.state.name,
      change: serializeChange(change, this.state.objects),
      toString: function() { return printOp(this); }
    });
  }

  newOperation(op) {
    this.buffer.push(op);
    this.composeOpsInBuffer();
    return this.sendOperationIfPossible();
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // sending and receiving ops
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  sendOperationIfPossible() {
    if (this.error) {
      var msg = `sync client ecountered error, refusing to send to master, ${this.error}`;
      console.error(msg);
      return Promise.reject(new Error(msg));
    }

    var {buffer,pending} = this.state;
    if (pending.length || !buffer.length) return Promise.resolve();
    this.state.pending.push(buffer[0]);
    return this.send(buffer[0]);
  }

  async syncWithMaster() {
    // this.state.pending = [];
    // this.state.buffer = [];

    try {
      var lastOp = arr.last(this.history),
          answer = await this.sendMetaAndWait({
            request: "history-since-or-snapshot",
            since: lastOp ? lastOp.id : null
          });

      if (answer.type === "history") {
        return this.receiveOpsFromMaster(answer.history);
      }

      if (answer.type === "snapshot") {
        throw new Error(`${this}: syncing from snapshot not yet implemented`);
      }

    } catch (e) {
      this.state.error = e;
      console.error(`Cannot sync ${this} with master: ${e}`);
      return Promise.reject(e);
    }
  }

  receiveMetaMsgsFromMaster(msgs, master, metaChannel) {
    for (let msg of msgs) {
      try {

        if (msg.inResponseTo) {
          var cb = this.state.metaMessageCallbacks[msg.inResponseTo];
          if (typeof cb === "function") return cb(msg);
  
        } else if (msg.request === "lock" || msg.request === "unlock") {
          var lock = msg.request === "lock"
          if (lock) this.goOfflineWithOpChannel();
          else this.goOnlineWithOpChannel();
          var answer = {
            inResponseTo: msg.id,
            type: "lock-result",
            locked: lock
          };
          return metaChannel.send(answer, this);
        }
      } catch (e) {
        console.error(`${this}: Error when processing message: ${i(msg)}: ${e}`)
      }

      console.error(`${this} got meta message but don't know what do to with it! ${i(msg)}}`)
    }
  }

  receiveOpsFromMaster(ops) {

    var {pending, history, buffer} = this.state;
    for (let op of ops) {

      if (pending.length && op.id === pending[0].id) {
        // it is a ack, i.e. that the operation or an equivalent (having the
        // same id) was send by this client. We received it b/c the server
        // applied it and broadcasted it subsequently. For this client this
        // means we can remove the op from pending
        pending.shift();
        var ackIndex = buffer.findIndex(ea => ea.id === op.id)+1;
        var opsTilAck = buffer.slice(0, ackIndex);
        this.state.buffer = buffer.slice(ackIndex);
        this.state.history = history.concat(opsTilAck);

      } else {
        // we got a new op from the server, transform it via the bridge /
        // buffer and apply it locally.
        var {transformedOp, transformedAgainstOps} = this.transform(op, buffer);
        this.state.buffer = transformedAgainstOps;
        history.push(transformedOp);
        this.apply(transformedOp);
      }
    }

    // try sending unsend ops in buffer
    this.sendOperationIfPossible();
  }

  apply(op) {

    // guard that protects from sending out changes that are created from
    // applying received operations
    this.state.isApplyingChange = true;
    try {
      applyChange(op.change, this)
    } catch (e) {
      console.log(`sync client apply error: ${e}`);
      this.state.error = e;
      throw e;
    } finally {
      this.state.isApplyingChange = false;
    }

  }

  changeTransform(tfmFn) { this.state.transformFunctions = [tfmFn]; }
  transform(op, againstOps) { return transformOp_1_to_n(op, againstOps, this.state.transformFunctions); }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // synced testing
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  isSynced() {
    var {opChannel, metaChannel} = this.state.connection;
    return this.buffer.length === 0
        && (!opChannel || opChannel.isEmpty())
        && (!metaChannel || metaChannel.isEmpty());
  }

  synced() {
    return promise.waitFor(() =>
      this.isSynced()).then(() => this);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // composition
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  composeOpsInBuffer() {
    // pair-wise try to compose operations in buffer that aren't send yet.
    var {pending, buffer} = this.state;

    // we can only compose operations that aren't yet being send, i.e. those that arent in pending;
    var onlyLocalIndex = 0;
    if (pending.length) { // pending can't be composed
      var last = arr.last(pending);
      onlyLocalIndex = buffer.findIndex(op => last === op) + 1;
    }

    var keep = buffer.slice(0,onlyLocalIndex),
        maybeCompose = buffer.slice(onlyLocalIndex);

    this.state.buffer = keep.concat(composeOps(maybeCompose));
  }

}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// master
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

export class MasterState {

  constructor(world, master) {
    this.error = null;
    this.world = world;
    this.objects = new Map();
    world.withAllSubmorphsDo(ea => this.objects.set(ea.id, ea));
    this.history = [];
    this.connections = [];
    this.locked = false;
    this.transformFunctions = [];
    this.metaMessageCallbacks = {};
  }

}


export class Master {

  constructor(world) {
    this.state = new MasterState(world);
  }

  toString() {
    return `<sync master hist:${this.history.length}>`
  }

  get error() { return this.state.error }

  get history() { return this.state.history; }
  printHist() { return printOps(this.state.history); }


  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // connections
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  addConnection(c) { return arr.pushIfNotIncluded(this.state.connections, c); }
  removeConnection(c) { return arr.remove(this.state.connections, c); }
  get connections() { return this.state.connections; }
  connectionFor(client) { return this.connections.find(c => c.opChannel && c.opChannel.senderRecvrA === client); }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // meta communication
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  sendMeta(connection, msg) {
    if (!connection || !connection.metaChannel)
      throw new Error(`${this}: No (meta) connection when sending meta message ${i(msg)}`);
    return connection.metaChannel.send(msg, this);
  }

  sendMetaAndWait(connection, msg) {
    return new Promise((resolve, reject) => {
      msg.id = msg.id || string.newUUID();
      this.state.metaMessageCallbacks[msg.id] = answer =>
        answer.error ? reject(new Error(answer.error)) : resolve(answer);
      this.sendMeta(connection, msg);
    });
  }

  receiveMetaMsgsFromClient(msgs, client, metaChannel) {
    for (let msg of msgs) {

      if (msg.inResponseTo) {
        var cb = this.state.metaMessageCallbacks[msg.inResponseTo];
        if (typeof cb === "function") cb(msg);
        return;
      }

      switch (msg.request) {
        case "history-since-or-snapshot":
          this.answerHistorySinceOrSnapshotMessage(msg, metaChannel);
          break;

        case "lock": case "unlock":
          this.answerLockAndUnlockRequest(msg, metaChannel);
          break;
          
        default:
          console.error(`master received meta message ${i(msg)} but don't know what to do with it!`);
      }
    }
  }

  answerHistorySinceOrSnapshotMessage(msg, metaChannel) {
    var answer = {
      inResponseTo: msg.id,
      type: "history",
      history: this.historySince(msg.since)
    };
    metaChannel.send(answer, this);
  }

  async answerLockAndUnlockRequest(msg, metaChannel) {
    var err, lock = msg.request === "lock";

    console.log("lock" ? "locking..." : "unlocking");

    // only one lock at a time
    if (lock && this.state.locked) {
      var answer = {
        inResponseTo: msg.id,
        type: msg.request + "-result",
        error: "Already locked"
      };
      metaChannel.send(answer, this);
      return;
    }

    if (lock) this.state.locked = true;

    // forward to all clients...
    try {
      await Promise.all(this.connections.map(c =>
          this.sendMetaAndWait(c, Object.assign({}, msg, {id: null}))))
    } catch (e) {
      err = e;
      console.error(`Error locking / unlocking all clients in master: ${err}`);
    }

    var answer = {inResponseTo: msg.id, type: msg.request + "-result", error: err ? String(err.stack || err) : null, locked: lock};
    metaChannel.send(answer, this);

    if (!lock) this.state.locked = false;
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // operation-related communication
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  receiveOpsFromClient(ops, client, connection) {
    // ops to be expected to contigous operations, i.e. ops[n].id === ops[n+1].parent
    if (!ops.length) return;
    var opsForTransform = this.findOpsForTransform(ops[0]),
        transformed = ops.map(op => this.transform(op, opsForTransform).transformedOp);
    this.state.history = this.state.history.concat(transformed);
    transformed.forEach(op => this.apply(op));
    this.broadcast(ops, client);
  }

  broadcast(ops, sender) {
    if (this.error) {
      console.error(`sync master ecountered error, refusing to broadcast ${this.error}`);
      return;
    }

    var sourceCon = this.connectionFor(sender),
        priorityCons = arr.without(this.connections, sourceCon);

    priorityCons.forEach(ea => ea.opChannel.send(ops, this));
    if (sourceCon) sourceCon.opChannel.send(ops, this);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // ops / transforms
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  findOpsForTransform(childOp) {
    // childOp is expected to be an operation that is directly based on an
    // operation of the servers history; find operations that were added since
    // childOp's parent and transform childOp against them
    return this.historySince(childOp.parent);
  }

  historySince(opId) {
    return arr.takeWhile(
          this.state.history.slice().reverse(),
          (ea) => ea.id !== opId).reverse();
  }

  apply(op) {
    // ...to local state
    try {
      applyChange(op.change, this)
    } catch (e) {
      console.log(`sync master apply error: ${e}`);
      this.state.error = e;
      throw e;
    }

  }

  changeTransform(tfmFn) { this.state.transformFunctions = [tfmFn]; }
  transform(op, againstOps) { return transformOp_1_to_n(op, againstOps, this.state.transformFunctions); }

}
