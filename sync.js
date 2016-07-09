import { arr, string, obj, promise, fun } from "lively.lang";
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
  var {id, parent, components: [change]} = op;
  return `${printUUID(id)} < ${printUUID(parent)} | ${printChange(change)}`
}

function printOps(ops) { return ops.map(printOp).join("\n"); }





// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// transforming ops
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function transformOp_1_to_n(op, againstOps) {
  // transform an op against other ops
  if (!againstOps.length)
    return {transformedOp: op, transformedAgainstOps: []}

  var transformedOp = op, transformedAgainstOps = [];
  for (let op1 of againstOps) {
    var {tfmd1, tfmd2} = tfmPair(op1, transformedOp);
    transformedAgainstOps.push(tfmd1);
    transformedOp = tfmd2;
  }
  return {transformedOp, transformedAgainstOps: againstOps}

  function tfmPair(op1, op2) {
    var tfmd1 = obj.clone(op1), tfmd2 = obj.clone(op2);
    tfmd1.parent = op2.id;
    tfmd2.parent = op1.id;;
    return {tfmd1, tfmd2};
  }

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
  // FIXME we currently assume 1 component per op
  if (op1.components.length != 1 || op2.components.length != 1) return [op1, op2];
  
  var [change1] = op1.components, [change2] = op2.components;
  
  // composing setters: Use the last change as it overrides everything before
  if (change1.prop === change2.prop
   && isEqualRef(change1.target, change2.target)
   && change1.type === "setter" && change2.type === "setter")
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
    this.lifetime = 5;
    this.debug = true;
  }

  isOnline() { return true; }

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
      else if (msgs.length === 1) string += msgs[0];
      else string += "\n  " + msgs.join("\n  ");
      console.log(string);
    }
    
    queue.push(...(Array.isArray(content) ? content : [content]));

    // try again later...
    if (!this.isOnline()) return setTimeout(() => this.send([], sender), 200);

    return Promise.resolve().then(() =>
      new Promise((resolve, reject) =>
        fun.throttleNamed(`${this.id}-${descr}`, delay, () => {
          try {
            recvr[method](queue, sender, this);
            resolve();
          } catch (e) {
            console.error(`Error in ${method} of ${recvr}: ${e.stack || e}`);
            reject(e);
          } finally { queue.length = 0; }
        })()))
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
    this.error = null;
    this.world = world;
    this.objects = new Map();
    world.withAllSubmorphsDo(ea => this.objects.set(ea.id, ea));
    this.history = [];
    this.pending = [];
    this.buffer = [];
    this.isApplyingChange = false;
    this.enabled = true;
    this.delay = 0;
  }

}

export class Client {

  constructor(world, name) {
    this.state = new ClientState(world);
    this.state.name = name || "some client"
  }

  toString() {
    return `<sync ${this.state.name} hist:${this.history.length} buf:${this.buffer.length}>`
  }

  get error() { return this.state.error }

  get enabled() { return this.state.enabled; }
  set enabled(bool) { this.state.enabled = bool; if (bool) this.syncWithMaster(); }

  get history() { return this.state.history; }
  get buffer() { return this.state.buffer; }
  printHist() { return printOps(this.history); }
  printBuffer() { return printOps(this.buffer); }

  get master() {
    return this.state.connection ?
      this.state.connection.senderRecvrB : null;
  }

  send(op) {
    if (!this.hasConnection())
      throw new Error(`Cannot send, not connected!`)
    this.state.connection.send(op, this);
  }

  disconnectFromMaster() {
    var s = this.state;
    if (!s.connection) return;
    var master = s.connection.senderRecvrB;
    master.removeConnection(s.connection);
    s.connection = null;
  }

  connectToMaster(master) {
    this.disconnectFromMaster();
    this.state.connection = new Channel(this, "receiveOpsFromMaster", master, "receiveOpsFromClient")
    master.addConnection(this.state.connection);
  }

  hasConnection() { return !!this.state.connection; }
  isOnline() { return this.hasConnection() && this.state.connection.isOnline(); }

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
      parent: parent ? parent.id : null, id: string.newUUID(),
      components: [serializeChange(change, this.state.objects)],
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
    if (!this.enabled || pending.length || !buffer.length) return Promise.resolve();
    this.state.pending.push(buffer[0]);
    return this.send(buffer[0]);
  }

  syncWithMaster() {
    // this.state.pending = [];
    // this.state.buffer = [];

return console.error(`Not yet implemented`);

    this.state.isApplyingChange = false;
    this.state.error = false
    var lastOp = arr.last(this.history),
        hist = this.master.historySince(lastOp ? lastOp.id : null);
    this.receive(hist);
  }

  receiveOpsFromMaster(ops, master, connection) {

    if (!this.enabled) return;

// if (client1 === this) debugger;
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
      op.components.forEach(change => applyChange(change, this));
    } catch (e) {
      console.log(`sync client apply error: ${e}`);
      this.state.error = e;
      throw e;
    } finally {
      this.state.isApplyingChange = false;
    }

  }

  transform(op, againstOps) { return transformOp_1_to_n(op, againstOps); }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // synced testing
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  isSynced() { return this.buffer.length === 0 }

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
    this.enabled = true;
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
  connectionFor(client) { return this.connections.find(c => c.senderRecvrA === client); }

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

    priorityCons.forEach(ea => ea.send(ops, this));
    if (sourceCon) sourceCon.send(ops, this);
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
// show(`APPLY: ${op.id} ${obj.inspect(op.components[0], {maxDepth: 2})}`)

    try {
      op.components.forEach(change => applyChange(change, this));
    } catch (e) {
      console.log(`sync master apply error: ${e}`);
      this.state.error = e;
      throw e;
    }

  }

  transform(op, againstOps) { return transformOp_1_to_n(op, againstOps); }

}
