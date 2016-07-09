/*global declare, it, describe, beforeEach, afterEach*/

import { expect } from "mocha-es6";
import { morph } from "../index.js";
import { promise } from "lively.lang";
import { pt, Color, Rectangle } from "lively.graphics";
import { Client, Master } from "lively.morphic/sync.js";
import { buildTestWorld, destroyTestWorld } from "./helper.js";

// var env1, env2, env3,
//     client1, client2, master;

var state;

async function setup(nClients) {
  if (!state) state = {};
  if (state.running) teardown();

  var masterEnv = state.masterEnv = await buildTestWorld({type: "world", name: "world", extent: pt(300,0)}, pt(0,0)),
      master = state.master = new Master(masterEnv.world);
  state.masterWorld = masterEnv.world;

  for (var i = 0; i < nClients; i++) {
    let env = state[`env${i+1}`] = await buildTestWorld(masterEnv.world.exportToJSON(), pt(0,300*(i+1))),
        client = state[`client${i+1}`] = new Client(env.world, `client${i+1}`);
    client.connectToMaster(master);
    state[`world${i+1}`] = env.world;
    env.world.signalMorphChange = function(change, morph) { client.newChange(change) }
  }
  state.running = true;
}

function teardown() {
  var s = state;
  if (!s) return;
  s.running = false;

  destroyTestWorld(s.masterEnv);

  Object.keys(s).forEach(name => {
    if (name.match(/^env/)) {
      var env = s[name];
      env.world.signalMorphChange = function() {}
      try {
        destroyTestWorld(env);
      } catch (e) { console.error(e); }
    } else if (name.match(/^client/)) {
      var client = s[name];
      client.receive = function() {};
    }
  });
}


describe("messaging between master and client", () => {

  beforeEach(async () => setup(1));
  afterEach(async () => teardown());

  it("single op", async () => {
    state.world1.fill = Color.green;
    await promise.delay(30);
    expect(state.master.history).to.have.length(1);
    expect(state.client1.history).to.have.length(1);
    expect(state.client1.buffer).to.have.length(0);
    expect(state.masterWorld.fill).equals(Color.green);
  });

});

describe("syncing master with two clients", function() {

  this.timeout(5*1000);

  beforeEach(async () => setup(2));
  afterEach(async () => teardown());

  it("simple prop", async () => {
    var {world1, world2, masterWorld, client1} = state;
    world1.fill = Color.green
    await client1.synced();
    expect(masterWorld.fill).equals(Color.green);
    expect(world2.fill).equals(Color.green);
  });

  it("adding a morph", async () => {
    var {world1, world2, masterWorld, client1, client2, master} = state;
    world1.addMorph({name: "m1", position: pt(10,10), extent: pt(50,50), fill: Color.red});
    await client1.synced();

    // is morph state completely synced?
    expect(masterWorld.exportToJSON()).deep.equals(world1.exportToJSON(), "masterWorld");
    expect(world2.exportToJSON()).deep.equals(world1.exportToJSON(), "world2");
    
    // has morph an owner?
    expect(masterWorld.get("m1").owner).equals(masterWorld);
    expect(world2.get("m1").owner).equals(world2);

    // is history consistent?
    expect(client1.history).to.have.length(1);
    var expectedChange = {
      prop: "submorphs",
      target: {type: "lively-sync-morph-ref", id: world1.id},
      type: "method-call",
      selector: "addMorph",
      receiver: {type: "lively-sync-morph-ref", id: world1.id},
      args: [{type: "lively-sync-morph-spec", spec: {name: "m1", position: pt(10,10), extent: pt(50,50)}}]
    }
    expect(client1.history[0].components).containSubset([expectedChange]);
    expect(client2.history).to.have.length(1);
    expect(master.history[0].components).containSubset([expectedChange]);
    expect(master.history).to.have.length(1);

    // are there different morphs in each world?
    var world1Morphs = world1.withAllSubmorphsDo(ea => ea),
        world2Morphs = world2.withAllSubmorphsDo(ea => ea),
        world3Morphs = masterWorld.withAllSubmorphsDo(ea => ea);
    world1Morphs.map((m, i) => {
      expect(m.id)              .equals(world2Morphs[i].id, `morphs ${m.name} (${i}) in world 1 and 2 have not the same id`);
      expect(m.id)              .equals(world3Morphs[i].id, `morphs ${m.name} (${i}) in world 1 and 3 have not the same id`);
      expect(world2Morphs[i].id).equals(world3Morphs[i].id, `morphs ${m.name} (${i}) in world 2 and 3 have not the same id`);
      expect(m)              .not.equals(world2Morphs[i], `morphs ${m.name} (${i}) in world 1 and 2 are identical`);
      expect(m)              .not.equals(world3Morphs[i], `morphs ${m.name} (${i}) in world 1 and 3 are identical`);
      expect(world2Morphs[i]).not.equals(world3Morphs[i], `morphs ${m.name} (${i}) in world 2 and 3 are identical`);
    });

  });

  it("if possible, changes are compacted", async () => {
    var {world1, world2, masterWorld, client1, master} = state;
    var m = world1.addMorph({position: pt(10,10), extent: pt(50,50), fill: Color.red});
    m.moveBy(pt(1,1)); m.moveBy(pt(1,1)); m.moveBy(pt(2,2));
    await client1.synced();
    console.log("???")
    expect(client1.history).to.have.length(2);
    expect(master.history).to.have.length(2);
    expect(master.history[0]).to.containSubset({components: [{type: "method-call", selector: "addMorph"}]})
    expect(master.history[1]).to.containSubset({components: [{type: "setter", prop: "position", value: pt(14,14)}]})
  });

  it("sync image", async () => {
    var {world1, client1, env2} = state;
    var m = world1.addMorph({type: "image", extent: pt(50,50)});
    await client1.synced();
    // make sure it is rendered correctly
    expect(env2.renderer.getNodeForMorph(env2.world.submorphs[0])).property("tagName", "IMG");
  });
});
