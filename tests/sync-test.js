/*global declare, it, describe, beforeEach, afterEach*/

import { expect } from "mocha-es6";
import { morph } from "../index.js";
import { pt, Color, Rectangle } from "lively.graphics";
import { Client, Master } from "lively.morphic/sync.js";
import { buildTestWorld, destroyTestWorld } from "./helper.js";

var env1, env2, env3,
    client1, client2, master;

describe("syncing morphic", function() {

  this.timeout(5*1000);


  beforeEach(async () => {
    env1 = await buildTestWorld({type: "world", name: "world", extent: pt(300,300)}, pt(0,0))
    env2 = await buildTestWorld(env1.world.exportToJSON(), pt(0,300))
    env3 = await buildTestWorld(env1.world.exportToJSON(), pt(0,600))


    client1 = new Client(env1.world);
    client2 = new Client(env2.world);
    master = new Master(env3.world);

    master.clients = [client1, client2];
    client1.master = client2.master = master;

    env1.world.signalMorphChange = function(change, morph) { client1.newChange(change) }
    env2.world.signalMorphChange = function(change, morph) { client2.newChange(change) }
  });

  afterEach(async () => {
    for (var i = 0; i < 4; i++) {
      show(`${env1.world.withAllSubmorphsDo(ea => ea).length} / ${env2.world.withAllSubmorphsDo(ea => ea).length} / ${env3.world.withAllSubmorphsDo(ea => ea).length}`)
      await lively.lang.promise.delay(500);
    }

    env1.world.signalMorphChange = function() {}
    env1.world.signalMorphChange = function() {}
    client1.receive = function() {};
    client1.receive = function() {};

    destroyTestWorld(env1);
    destroyTestWorld(env2);
    destroyTestWorld(env3);
    env1.world.signalMorphChange = function() {};
  });

  it("syncs adding a morph", async () => {
    env1.world.addMorph({position: pt(10,10), extent: pt(50,50)});
    await client1.synced();

    // is morph state completely synced?
    expect(env2.world.exportToJSON()).deep.equals(env1.world.exportToJSON());
    expect(env3.world.exportToJSON()).deep.equals(env1.world.exportToJSON());
    
    // is history consistent?
    expect(client1.state.history).to.have.length(1);
    expect(client1.state.history).containSubset([{components: [{prop: "submorphs", action: "add"}]}]);
    expect(client2.state.history).to.have.length(1);
    expect(master.state.history).to.have.length(1);

    // are there different morphs in each world
    var world1Morphs = env1.world.withAllSubmorphsDo(ea => ea),
        world2Morphs = env2.world.withAllSubmorphsDo(ea => ea),
        world3Morphs = env3.world.withAllSubmorphsDo(ea => ea);
    world1Morphs.map((m, i) => {
      if (m === world2Morphs[i])               expect.fail(undefined, undefined, `morphs ${m.name} (${i}) in world 1 and 2 are identical`);
      if (m === world3Morphs[i])               expect.fail(undefined, undefined, `morphs ${m.name} (${i}) in world 1 and 3 are identical`);
      if (world2Morphs[i] === world3Morphs[i]) expect.fail(undefined, undefined, `morphs ${m.name} (${i}) in world 2 and 3 are identical`);
    });

  });

  it("if possible, changes are compacted", async () => {
    var m = env1.world.addMorph({position: pt(10,10), extent: pt(50,50)});
    m.moveBy(pt(1,1)); m.moveBy(pt(1,1)); m.moveBy(pt(2,2));
    await client1.synced();
    expect(client1.state.history).to.have.length(2);
    expect(master.state.history).to.have.length(2);
    expect(master.state.history[0]).to.containSubset({components: [{action: "add", prop: "submorphs"}]})
    expect(master.state.history[1]).to.containSubset({components: [{action: "set", prop: "position", value: pt(14,14)}]})
  });
});
