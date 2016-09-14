/*global declare, it, describe, beforeEach, afterEach*/
import { expect } from "mocha-es6";
import { promise } from "lively.lang";
import { pt, Color } from "lively.graphics";
import { morph, World, show } from "../index.js";
import { createDOMEnvironment } from "../rendering/dom-helper.js";
import { MorphicEnv } from "../index.js";

function wait(n) {
  return n ? promise.delay(n*1000) : Promise.resolve();
}

function installEventLogger(morph, log) {
  var loggedEvents = [
    "onMouseDown","onMouseUp","onMouseMove",
    "onDragStart", "onDrag", "onDragEnd",
    "onGrab", "onDrop",
    "onHoverIn", "onHoverOut",
    "onFocus", "onBlur",
    "onKeyDown", "onKeyUp"]
  loggedEvents.forEach(name => {
    morph[name] = function(evt) {
      log.push(name + "-" + morph.name);
      this.constructor.prototype[name].call(this, evt);
    }
  });
}

var env, world, submorph1, submorph2, submorph3, submorph4, eventLog;
function createDummyWorld() {
  world = new World({name: "world", extent: pt(300,300)})
  world.submorphs = [{
      name: "submorph1", extent: pt(100,100), position: pt(10,10), fill: Color.red,
      submorphs: [{name: "submorph2", extent: pt(20,20), position: pt(5,10), fill: Color.green}]
    },
    {name: "submorph3", extent: pt(50,50), position: pt(200,20), fill: Color.yellow},
    {name: "submorph4", type: "text", extent: pt(50,50), position: pt(200,200), fill: Color.blue, textString: "text"}];

  submorph1 = world.submorphs[0];
  submorph2 = world.submorphs[0].submorphs[0];
  submorph3 = world.submorphs[1];
  submorph4 = world.submorphs[2];

  eventLog = [];
  [world,submorph1,submorph2,submorph3,submorph4].forEach(ea => installEventLogger(ea, eventLog));

  return world;
}

async function setup() {
  env = new MorphicEnv(await createDOMEnvironment());
  // env = new MorphicEnv();
  MorphicEnv.pushDefault(env);
  await env.setWorld(createDummyWorld());
}

function teardown() {
  MorphicEnv.popDefault().uninstall()
}

function assertEventLogContains(stuff) {
  expect(stuff).equals(eventLog)
  eventLog.length = 0;
}



describe("event basics", function() {

  // jsdom sometimes takes its time to initialize...
  if (System.get("@system-env").node)
    this.timeout(10000);

  beforeEach(setup);
  afterEach(teardown);

  it("stop event", () => {
    submorph1.onMouseDown = function(evt) {
      evt.stop();
      eventLog.push("onMouseDown-submorph1");
    }
    env.eventDispatcher.simulateDOMEvents({type: "pointerdown", target: submorph2});
    assertEventLogContains([
      "onFocus-submorph2",
      "onMouseDown-world",
      "onMouseDown-submorph1"]);
  });

});


describe("pointer event related", function() {

  beforeEach(setup);
  afterEach(teardown);

  it("mousedown on submorph", () => {
    env.eventDispatcher.simulateDOMEvents({type: "pointerdown", target: submorph2});
    assertEventLogContains([
      "onFocus-submorph2",
      "onMouseDown-world",
      "onMouseDown-submorph1",
      "onMouseDown-submorph2"]);
  });

  it("world has hand and moves it", () => {
    env.eventDispatcher.simulateDOMEvents({type: "pointermove", target: submorph2, position: pt(120,130)});
    expect(world.submorphs[0]).property("isHand", true);
  });


  describe("drag", () => {

    it("morph", () => {
      submorph2.grabbable = false;
      env.eventDispatcher.simulateDOMEvents({type: "pointerdown", target: submorph2, position: pt(20, 25)});
      assertEventLogContains(["onFocus-submorph2", "onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2"]);

      env.eventDispatcher.simulateDOMEvents({type: "pointermove", target: submorph2, position: pt(30, 33)});
      assertEventLogContains(["onMouseMove-world", "onDragStart-submorph2"]);

      env.eventDispatcher.simulateDOMEvents({type: "pointermove", target: submorph2, position: pt(34, 36)});
      assertEventLogContains(["onMouseMove-world", "onDrag-submorph2"]);

      env.eventDispatcher.simulateDOMEvents({type: "pointerup", target: submorph2, position: pt(34, 36)});
      assertEventLogContains(["onMouseUp-world", "onDragEnd-submorph2"]);
    });

    it("computes drag delta", async () => {
      var m = world.addMorph(morph({extent: pt(50,50), fill: Color.pink, grabbable: false}));
      await m.whenRendered()
      var dragStartEvent, dragEvent, dragEndEvent;
      m.onDragStart = evt => dragStartEvent = evt;
      m.onDrag = evt => dragEvent = evt;
      m.onDragEnd = evt => dragEndEvent = evt;
      env.eventDispatcher.simulateDOMEvents(
        {type: "pointerdown", position: pt(20, 25)},
        {type: "pointermove", position: pt(20, 25)},
        {type: "pointermove", position: pt(30, 35)},
        {type: "pointermove", position: pt(40, 50)});
      expect(dragEvent.state.dragDelta).equals(pt(10,15))
      env.eventDispatcher.simulateDOMEvents({type: "pointerup", target: m, position: pt(40, 51)});
      expect(dragEndEvent.state.dragDelta).equals(pt(0, 1))
    });

  });

  describe("click counting", () => {

    function click(type = "pointerdown", position = pt(20, 25)) {
      return env.eventDispatcher.simulateDOMEvents({type, target: submorph2, position});
    }

    it("accumulates and is time based", async () => {
      var state = env.eventDispatcher.eventState;
      expect(state.clickCount).equals(0);
      await click(); expect(state.clickCount).equals(1);
      await click("pointerup"); expect(state.clickCount).equals(0);
      await click(); expect(state.clickCount).equals(2);
      await click("pointerup"); expect(state.clickCount).equals(0);
      await promise.delay(400);
      await click(); expect(state.clickCount).equals(1);
    });

  });


  describe("grab / drop", () => {

    it("morph", async () => {
      submorph2.grabbable = true;
      var morphPos = submorph2.globalPosition;

      // grab
      env.eventDispatcher.simulateDOMEvents(
        {type: "pointerdown", target: submorph2, position: morphPos.addXY(5,5)},
        {type: "pointermove", target: submorph2, position: morphPos.addXY(10,10)});
      assertEventLogContains([
        "onFocus-submorph2", "onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2",
        "onMouseMove-world", "onGrab-submorph2"]);
      expect(world.hands[0].carriesMorphs()).equals(true);
      var offsetWhenGrabbed = submorph2.position;

      // drop
      env.eventDispatcher.simulateDOMEvents(
        {type: "pointermove", target: submorph2, position: morphPos.addXY(15,15)},
        {type: "pointermove", target: submorph2, position: morphPos.addXY(20,20)},
        {type: "pointerup", target: world, position: morphPos.addXY(20,20)});
      assertEventLogContains(["onMouseMove-world", "onMouseMove-world", "onMouseUp-world", "onDrop-world"]);
      expect(world.hands[0].carriesMorphs()).equals(false);
      expect(submorph2.owner).equals(world);
      expect(submorph2.position).equals(morphPos.addXY(10,10));
    });

    it("dropped morph has correct position", async () => {
      world.submorphs = [
        {position: pt(10,10), extent: pt(100,100), fill: Color.red,
         rotation: -45,
         origin: pt(50,50)
         },
        {position: pt(60,60), extent: pt(20,20), fill: Color.green, grabbable: true, origin: pt(10,10)
        }];
      var [m1, m2] = world.submorphs;
      var prevGlobalPos = m2.globalPosition;

      world.renderAsRoot(env.renderer);
      env.eventDispatcher.simulateDOMEvents(
        {type: "pointerdown", target: m2, position: pt(60,60)},
        {type: "pointermove", target: m2, position: (pt(65,65))});
      expect(m2.globalPosition).equals(prevGlobalPos);
      expect(m2.owner).not.equals(world);
      env.eventDispatcher.simulateDOMEvents(
        {type: "pointermove", target: m2, position: pt(50,50)});
      expect(m2.globalPosition).equals(pt(45,45));
      env.eventDispatcher.simulateDOMEvents(
        {type: "pointerup", target: m1, position: (pt(2,2))});
      expect(m2.owner).equals(m1);
      expect(m2.globalPosition).equals(pt(45,45));
    });

  });


  describe("hover", () => {

    it("into world", async () => {
      await env.eventDispatcher.simulateDOMEvents({target: world, type: "pointerover", position: pt(50,50)}).whenIdle();
      assertEventLogContains(["onHoverIn-world"]);
    });

    it("in and out world", async () => {
      await env.eventDispatcher.simulateDOMEvents(
        {target: world, type: "pointerover", position: pt(50,50)},
        {target: world, type: "pointerout", position: pt(50,50)}).whenIdle();
      assertEventLogContains(["onHoverIn-world", "onHoverOut-world"]);
    });

    it("in and out single morph", async () => {
      await env.eventDispatcher.simulateDOMEvents(
        {target: submorph3, type: "pointerover", position: pt(50,50)},
        {target: submorph3, type: "pointerout", position: pt(50,50)}).whenIdle();;
      assertEventLogContains(["onHoverIn-world", "onHoverIn-submorph3", "onHoverOut-world","onHoverOut-submorph3"]);
    });

    it("hover in and out with submorph", async () => {
      // simulate the over/out dom events when moving
      // - into submorph1 => into submorph2 (contained in 1) => out of submorph2 => out of submorph1
      await env.eventDispatcher.simulateDOMEvents({type: "pointerover", target: submorph1, position: pt(10,10)}).whenIdle();

      await env.eventDispatcher.simulateDOMEvents(
        {type: "pointerout", target: submorph1, position: pt(15,20)},
        {type: "pointerover", target: submorph2, position: pt(15,20)}).whenIdle();

      await env.eventDispatcher.simulateDOMEvents(
        {type: "pointerout", target: submorph2, position: pt(15,41)},
        {type: "pointerover", target: submorph1, position: pt(15,41)}).whenIdle();

      await env.eventDispatcher.simulateDOMEvents({type: "pointerout", target: submorph1, position: pt(9,9) }).whenIdle();

      assertEventLogContains([
        "onHoverIn-world", "onHoverIn-submorph1", "onHoverIn-submorph2", "onHoverOut-submorph2", "onHoverOut-world", "onHoverOut-submorph1"]);
    });

    it("hover in and out with submorph sticking out", async () => {

      var tl = submorph1.topLeft;
      submorph2.topRight = pt(submorph1.width + 10, 0);
      await env.eventDispatcher.simulateDOMEvents({type: "pointerover", target: submorph2, position: pt(109, 10)}).whenIdle();
      await env.eventDispatcher.simulateDOMEvents({type: "pointerout", target: submorph2, position: pt(111, 10)}).whenIdle();

      assertEventLogContains([
        "onHoverIn-world", "onHoverIn-submorph1", "onHoverIn-submorph2", "onHoverOut-world", "onHoverOut-submorph1", "onHoverOut-submorph2"]);
    });

  });

});



describe("scroll events", () => {


  beforeEach(async () => {
    await setup();
    submorph1.clipMode = "auto";
    submorph2.extent = pt(200,200);
    await submorph1.whenRendered();
  });
  afterEach(teardown);

  it("has correct scroll after scroll event and onScroll is triggered", async () => {
    var called = false;
    submorph1.onScroll = () => called = true;
    await env.eventDispatcher.simulateDOMEvents({type: "scroll", target: submorph1, scrollLeft: 20, scrollTop: 100}).whenIdle();
    expect(submorph1.scroll).equals(pt(20,100));
    expect().assert(called, "onScroll not called");
  });

});



describe("key events", () => {

  beforeEach(setup);
  afterEach(teardown);

  it("focus + blur", async () => {
    await env.eventDispatcher.simulateDOMEvents({target: submorph1, type: "focus"});
    assertEventLogContains(["onFocus-submorph1"]);
    expect().assert(submorph1.isFocused(), "submorph1 not focused");
    expect().assert(!submorph2.isFocused(), "submorph2 focused");

    await env.eventDispatcher.simulateDOMEvents({target: submorph1, type: "blur"});
    assertEventLogContains(["onBlur-submorph1"]);
    expect().assert(!submorph1.isFocused(), "submorph1 still focused");
    expect().assert(!submorph2.isFocused(), "submorph2 focused 2");
  });

  it("key down", async () => {
    submorph2.focus();
    await env.eventDispatcher.simulateDOMEvents({type: "keydown", ctrlKey: true, keyCode: 65});
    assertEventLogContains([
      "onFocus-submorph2",
      "onKeyDown-world",
      "onKeyDown-submorph1",
      "onKeyDown-submorph2"
    ]);
  });

  it("key down keyCombo", async () => {
    submorph1.focus();
    var pressed; submorph1.onKeyDown = evt => pressed = evt.keyCombo;
    env.eventDispatcher.simulateDOMEvents({type: "keydown", ctrlKey: true, key: "A"});
    expect(pressed).equals("Ctrl-A")
  });

  it("key up keyCombo", async () => {
    submorph1.focus();
    var pressed; submorph1.onKeyUp = evt => pressed = evt.keyCombo;
    env.eventDispatcher.simulateDOMEvents({type: "keyup", altKey: true, shiftKey: true, key: "X"});
    expect(pressed).equals("Alt-Shift-X")
  });

});

describe("event simulation", () => {

  beforeEach(setup);
  afterEach(teardown);

  it("click", async () => {
    await env.eventDispatcher.simulateDOMEvents({type: "click", position: pt(25,25)});
    assertEventLogContains([
      "onFocus-submorph2",
      "onMouseDown-world", "onMouseDown-submorph1", "onMouseDown-submorph2",
      "onMouseUp-world", "onMouseUp-submorph1", "onMouseUp-submorph2"]);
  });

});


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
import KillRing from "../events/KillRing.js";

describe("kill ring", () => {

  it("max size", async () => {
    var kr = new KillRing(3);
    kr.add("a");
    kr.add("b");
    kr.add("c");
    kr.add("d");
    expect(kr.buffer).equals(["b", "c", "d"]);
  });

  it("rotates", async () => {
    var kr = new KillRing(3);
    kr.add("a");
    kr.add("b");
    kr.add("c");
    expect(kr.yank()).equals("c");
    kr.back();
    kr.back();
    expect(kr.yank()).equals("a");
    kr.back();
    expect(kr.yank()).equals("c");
  });

  it("add resets rotate", async () => {
    var kr = new KillRing(5);
    kr.add("a");
    kr.add("b");
    kr.add("c");
    kr.back();
    kr.back();
    kr.add("d");
    expect(kr.yank()).equals("d");
    kr.back();
    expect(kr.yank()).equals("c");
  });


});
