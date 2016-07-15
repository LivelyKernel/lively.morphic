/*global declare, it, describe, beforeEach, afterEach*/
import { expect, chai } from "mocha-es6";
import { pt, Color } from "lively.graphics";
import { createDOMEnvironment } from "../rendering/dom-helper.js";
import { EventDispatcher } from "../events.js";
import { morph, World, Renderer } from "../index.js";

var domEnv;

function fakeEvent(targetMorph, type, pos = pt(0,0)) {
  // dom event simulator
  return {
    type: type,
    target: domEnv.document.getElementById(targetMorph.id),
    pointerId: "test-pointer-1",
    pageX: pos.x, pageY: pos.y,
    stopPropagation: () => {}, preventDefault: () => {}
  }
}

function installEventLogger(morph, log) {
  var loggedEvents = ["onMouseDown","onMouseUp","onMouseMove","onDragStart", "onDrag", "onDragEnd", "onGrab", "onDrop"]
  loggedEvents.forEach(name => {
    morph[name] = function(evt) {
      log.push(name + "-" + morph.name);
      this.constructor.prototype[name].call(this, evt);
    }
  });
}

var world, submorph1, submorph2, submorph3, submorph4,
    eventLog, renderer, eventDispatcher;

async function setup() {
  world = new World({
    name: "world", extent: pt(300,300),
    submorphs: [{
        name: "submorph1", extent: pt(100,100), position: pt(10,10), fill: Color.red,
        submorphs: [{name: "submorph2", extent: pt(20,20), position: pt(5,10), fill: Color.green}]
      },
      {name: "submorph3", extent: pt(50,50), position: pt(200,20), fill: Color.yellow},
      {name: "submorph4", type: "text", extent: pt(50,50), position: pt(200,200), fill: Color.blue, textString: "old text"}
    ]
  })
  submorph1 = world.submorphs[0];
  submorph2 = world.submorphs[0].submorphs[0];
  submorph3 = world.submorphs[1];
  submorph4 = world.submorphs[2];

  domEnv = await createDOMEnvironment();
  renderer = new Renderer(world, domEnv.document.body, domEnv);
  renderer.startRenderWorldLoop();

  eventDispatcher = new EventDispatcher(domEnv.window, world).install();

  eventLog = [];
  [world,submorph1,submorph2,submorph3,submorph4].forEach(ea => installEventLogger(ea, eventLog));
}

function teardown() {
  eventDispatcher && eventDispatcher.uninstall();
  renderer && renderer.clear();
  domEnv.destroy();
}

describe("events", () => {


  beforeEach(async () => setup());
  afterEach(() => teardown());

  it("mousedown on submorph", () => {
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointerdown"));
    expect(eventLog).deep.equals(["onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2"]);
  });

  it("stop event", () => {
    submorph1.onMouseDown = function(evt) {
      evt.stop();
      eventLog.push("onMouseDown-submorph1");
    }
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointerdown"));
    expect(eventLog).deep.equals(["onMouseDown-world", "onMouseDown-submorph1"]);
  });

  it("world has hand and moves it", () => {
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(120,130)));
    expect(world.submorphs[0]).property("isHand", true);
  });

  it("drag morph", () => {
    submorph2.grabbable = false;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointerdown", pt(20, 25)));
    expect(eventLog).deep.equals(["onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2"]);
    eventLog.length = 0;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(30, 33)));
    expect(eventLog).deep.equals(["onMouseMove-world", "onDragStart-submorph2"]);
    eventLog.length = 0;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(34, 36)));
    expect(eventLog).deep.equals(["onMouseMove-world", "onDrag-submorph2"]);
    eventLog.length = 0;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointerup", pt(34, 36)));
    expect(eventLog).deep.equals(["onMouseUp-world", "onDragEnd-submorph2"]);
  });

  it("drag computes drag delta", async () => {
    var m = world.addMorph(morph({extent: pt(50,50), fill: Color.pink, grabbable: false}));
    await m.whenRendered()
    var dragStartEvent, dragEvent, dragEndEvent;
    m.onDragStart = evt => dragStartEvent = evt;
    m.onDrag = evt => dragEvent = evt;
    m.onDragEnd = evt => dragEndEvent = evt;
    eventDispatcher.dispatchDOMEvent(fakeEvent(m, "pointerdown", pt(20, 25)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(m, "pointermove", pt(30, 35)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(m, "pointermove", pt(40, 50)));
    expect(dragEvent.state.dragDelta).equals(pt(10,15))
    eventDispatcher.dispatchDOMEvent(fakeEvent(m, "pointerup", pt(40, 51)));
    expect(dragEndEvent.state.dragDelta).equals(pt(0, 1))
  });

  it("grab morph", () => {
    submorph2.grabbable = true;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointerdown", pt(20, 25)));
    expect(eventLog).deep.equals(["onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2"]);
    eventLog.length = 0;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(30, 33)));
    expect(eventLog).deep.equals(["onMouseMove-world", "onGrab-submorph2"]);
    eventLog.length = 0;
    expect(world.hands[0].carriesMorphs()).equals(true);
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(34, 36)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(40, 41)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(world, "pointerup", pt(34, 36)));
    expect(eventLog).deep.equals(["onMouseMove-world", "onMouseMove-world", "onMouseUp-world", "onDrop-world"]);
    expect(world.hands[0].carriesMorphs()).equals(false);
  });

  xit("dropped morph has correct position", () => {
    world.submorphs = [
      {position: pt(10,10), extent: pt(40,40), fill: Color.red},
      {position: pt(60,60), extent: pt(20,20), fill: Color.green}];
    var [m1, m2] = world.submorphs;

    eventDispatcher.dispatchDOMEvent(fakeEvent(m2, "pointerdown", pt(60,60)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(m2, "pointermove", pt(65,65)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(m2, "pointermove", pt(66,66)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(world, "pointerup", pt(2,2)));

    expect(eventLog).deep.equals(["onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2"]);
    eventLog.length = 0;
    expect(eventLog).deep.equals(["onMouseMove-world", "onGrab-submorph2"]);
    eventLog.length = 0;
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointermove", pt(34, 36)));
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph2, "pointerup", pt(34, 36)));
    expect(eventLog).deep.equals(["onMouseMove-world", "onMouseUp-world", "onDrop-submorph2"]);
  });

  it("text input", () => {
    expect(submorph4).property("textString").equals("old text");
    domEnv.document.getElementById(submorph4.id).value = "new text";
    expect(submorph4).property("textString").equals("old text");
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph4, "input", pt(225, 225)));
    expect(submorph4).property("textString").equals("new text");
    domEnv.document.getElementById(submorph4.id).value = "really new text";
    expect(submorph4).property("textString").equals("new text");
    eventDispatcher.dispatchDOMEvent(fakeEvent(submorph4, "input", pt(225, 225)));
    expect(submorph4).property("textString").equals("really new text");
  });

});
