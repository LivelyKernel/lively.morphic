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
  // FIXME...
  
  change = obj.clone(change);
  var {world, objects} = syncController.state;

  if (change.prop === "submorphs" && change.action === "add") {
    var existingElement = objects.get(change.element._id);
    if (existingElement) {
      change.element = existingElement;
    } else {
      var spec = change.element, m = morph(change.element);
      change.element = Object.assign(m, spec);
      objects.set(change.element._id, change.element);
    }
  }

  var target = objects.get(change.target);
  if (!target) show(`Cannot find target for change ${obj.inspect(change, {maxDepth: 1})}`)
  else target.applyChange(change);
  lively.lang.fun.debounceNamed(world.id+"render-fix", 400, () => world.makeDirty())();
  world.makeDirty()
}

export class ClientState {

  constructor(world, master) {
    this.error = null;
    this.world = world;
    this.objects = new Map();
    world.withAllSubmorphsDo(ea => this.objects.set(ea.id, ea));
    this.history = [];
    this.serverAck = null;
    this.pending = [];
    this.buffer = [];
    this.master = master;
    this.isApplyingChange = false;
  }

}

export class MasterState {

  constructor(world, master) {
    this.error = null;
    this.world = world;
    this.objects = new Map();
    world.withAllSubmorphsDo(ea => this.objects.set(ea.id, ea));
    this.history = [];
    this.clients = [];
    this.outgoing = [];
  }

  addClient(c) { arr.pushIfNotIncluded(this._clients, c); }
  removeClient(c) { arr.remove(this._clients, c); }
}


export class Client {

  constructor(world) {
    this.state = new ClientState(world);
    this.syncedPromise = null;
  }

  get master() { return this.state.master; }
  set master(m) { return this.state.master = m; }

  get error() { return this.state.error }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // processing changes from local world, creating new op
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  newChange(change) {
    if (this.state.isApplyingChange) return;

    if (this.error) {
      console.error(`sync client ecountered error, refusing to accept new change, ${this.error}`);
      return;
    }

    var sanitizedChange;
    if (change.action === "set") sanitizedChange = obj.select(change, ["action", "prop", "value", "target"])
    else if (change.action === "add") sanitizedChange = obj.select(change, ["action", "prop","index", "element", "target"])
    else if (change.action === "remove") sanitizedChange = obj.select(change, ["action", "prop","index", "target"])
    else throw new Error(`Unknown change action: ${obj.inspect(change, {maxDepth: 1})}`)

    if (sanitizedChange.value && sanitizedChange.value.exportToJSON) sanitizedChange.value = sanitizedChange.value.exportToJSON()
    if (sanitizedChange.element && sanitizedChange.element.exportToJSON) sanitizedChange.element = sanitizedChange.element.exportToJSON()

    var parent = arr.last(this.state.history);
    this.newOperation({
      parent: parent ? parent.id : null,
      components: [sanitizedChange],
      id: string.newUUID()
    });
  }

  newOperation(op) {
    this.state.buffer.push(op);
    this.composeOpsInBuffer();
    this.sendOperationIfPossible();
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // sending and receiving ops
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  sendOperationIfPossible() {
    if (this.error) {
      console.error(`sync client ecountered error, refusing to send to master, ${this.error}`);
      return;
    }

    if (this.state.pending.length || !this.state.buffer) return;

    (() => {
      var [nextOp] = this.state.buffer;
      if (this.state.pending.length || !nextOp) return;
      this.state.pending.push(nextOp);
      // this.state.master.receive([JSON.parse(JSON.stringify(nextOp))]);
      this.state.master.receive([nextOp]);
    }).delay(.1);

    false && lively.lang.fun.throttleNamed(`${this.state.world.id}-send-to-master`, 10, () => {
      var [nextOp] = this.state.buffer;
      if (this.state.pending.length || !nextOp) return;
      this.state.pending.push(nextOp);
      this.state.master.receive([nextOp]);
    })();
  }

  receive(ops) {
    var {pending, history, buffer} = this.state;
    ops.forEach(op => {

      if (pending.length && op.id === pending[0].id) {
        // it is a ack, i.e. that the operation or an equivalent (having the
        // same id) was send by this client. We received it b/c the server
        // applied it and broadcasted it subsequently. For this client this
        // means we can remove the op from pending
        pending.shift();
        this.state.serverAck = op.id;
        var ackIndex = buffer.findIndex(ea => ea.id === op.id)+1;
        var opsTilAck = buffer.slice(0, ackIndex);
        this.state.buffer = buffer.slice(ackIndex);
        this.state.history = history.concat(opsTilAck);

      } else {
        // we got a new op from the server, transform it via the bridge /
        // buffer and apply it locally.
        var {transformedOp, transformedAgainstOps} = this.transform(op, buffer);
        this.state.buffer = transformedAgainstOps;
        this.apply(transformedOp);
        history.push(transformedOp);
      }
    });

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

  transform(op, againstOps) {
    // transform an op against other ops
    return {transformedOp: op, transformedAgainstOps: againstOps}
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // synced testing
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  isSynced() { return this.state.buffer.length === 0 }

  synced() {
    return lively.lang.promise.waitFor(() =>
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

    if (maybeCompose.length) {
      var composed = maybeCompose.slice(0,-1).reduceRight((composed, op1) => {
        var [op2, ...rest] = composed;
        return this.composeOpPair(op1, op2).concat(rest);
      }, maybeCompose.slice(-1));
      this.state.buffer = keep.concat(composed);
    }
  }

  composeOpPair(op1, op2) {
    if (op1.components.length === 1 && op2.components.length === 1) {
      var [change1] = op1.components, [change2] = op2.components;
      if (change1.prop === change2.prop && change1.target === change2.target
       && change1.action === "set" && change2.action === "set") {
        if (!change2.target.match(/hand/i))
           show(`${change1.value} ${change2.value}`)
         return [op2]
       }
    }
    return [op1, op2];
  }

}


export class Master {

  constructor(world) {
    this.state = new MasterState(world);
  }

  addClient(c) { return this.state.addClient(c); }
  removeClient(c) { return this.state.removeClient(c); }
  get clients() { return this.state.clients; }
  set clients(clients) { return this.state.clients = clients; }

  get error() { return this.state.error }

  findOpsForTransform(childOp) {
    return arr.takeWhile(
      this.state.history.slice().reverse(),
      (ea) => ea.id !== childOp.parent).reverse();
  }

  receive(ops) {
    // ops to be expected to contigous operations, i.e. ops[n].id === ops[n+1].parent
    if (!ops.length) return;
    var opsForTransform = this.findOpsForTransform(ops[0]),
        transformed = ops.map(op => this.transform(op, opsForTransform).transformedOp);
    this.state.history = this.state.history.concat(transformed);
    transformed.forEach(op => this.apply(op));
    this.broadcast(ops);
  }

  broadcast(ops) {
    if (this.error) {
      console.error(`sync master ecountered error, refusing to broadcast ${this.error}`);
      return;
    }

    this.state.clients.forEach(client => client.receive(ops));

    // arr.pushAll(this.state.outgoing, ops);
    
    // lively.lang.fun.throttleNamed(`${this.state.world.id}-sync-broadcast`, 10, () => {
    //   var ops = this.state.outgoing;
    //   this.state.outgoing = [];
    //   this.state.clients.forEach(client => client.receive(ops))
    // })();
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

  transform(op, againstOps) {
    return {transformedOp: op, transformedAgainstOps: againstOps}
  }

}
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
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// change (de)serialization
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

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

