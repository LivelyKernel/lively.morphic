/*global declare, it, describe, beforeEach, afterEach*/
import { createDOMEnvironment } from "../dom-helper.js";
import { morph, Renderer } from "../index.js";
import { expect, chai } from "mocha-es6";
import { pt, Color, Rectangle, Transform, rect } from "lively.graphics";
import { num } from "lively.lang";

describe("morphic", () => {

  var world, submorph1, submorph2, submorph3, image, ellipse,
      renderer, domEnv;

  beforeEach(async () => {
    world = morph({
      type: "world", name: "world", extent: pt(300,300),
      submorphs: [{
          name: "submorph1", extent: pt(100,100), position: pt(10,10), fill: Color.red,
          submorphs: [{name: "submorph2", extent: pt(20,20), position: pt(5,10), fill: Color.green}]
        },
        {name: "submorph3", extent: pt(50,50), position: pt(200,20), fill: Color.yellow},
        {type: "image", name: "image", extent: pt(80,80), position: pt(20, 200), fill: Color.lightGray},
        {type: "ellipse", name: "ellipse", extent: pt(50, 50), position: pt(200, 200), fill: Color.pink}
      ]
    });
    image = world.submorphs[2];
    ellipse = world.submorphs[3];
    submorph1 = world.submorphs[0];
    submorph2 = world.submorphs[0].submorphs[0];
    submorph3 = world.submorphs[1];

    domEnv = await createDOMEnvironment();
    renderer = new Renderer(world, domEnv.document.body, domEnv);
    renderer.startRenderWorldLoop()
  });

  afterEach(() => {
    renderer && renderer.clear();
    domEnv && domEnv.destroy();
  });

  describe("properties", () => {

    it("Morph has an extent", () => {
      expect(world.extent).deep.equals(pt(300,300))
    });

    it("Morph has an id", () => {
      expect(world.id).equals(renderer.domNode.id);
    });

  });

  describe("morphic relationship", () => {

    it("withAllSubmorphsDetect", () => {
      expect(world.withAllSubmorphsDetect(ea => ea === submorph2)).equals(submorph2);
      expect(world.withAllSubmorphsDetect(ea => ea === "foo")).equals(undefined);
    });

    it("withAllSubmorphsSelect", () => {
      expect(world.withAllSubmorphsSelect(ea => ea === submorph2)).deep.equals([submorph2]);
      expect(world.withAllSubmorphsSelect(ea => ea === "foo")).deep.equals([]);
    });

    it("ownerChain", () => {
      var owners = submorph2.ownerChain();
      expect(owners).deep.equals([submorph1, world], owners.map(ea => ea.name).join(", "));
    });

    it("world", () => {
      expect(submorph2.world()).equals(world);
    });

    it("adds morph in front of other", () => {
      var newMorph = world.addMorph({name: "new morph"}, world.submorphs[1]);
      expect(world.submorphs[0]).equals(submorph1);
      expect(world.submorphs[1]).equals(newMorph);
      expect(world.submorphs[2]).equals(submorph3);
    });
  });

  describe("rendering", () => {

    it("renderer associates domNodewith morph", () => {
      var node = renderer.getNodeForMorph(submorph2),
          morph = renderer.getMorphForNode(node);
      expect(morph).equals(submorph2, morph && morph.name);
      expect(renderer.domNode.childNodes[0].childNodes[0]).equals(node); // brittle, might change...
    });

    it("reuses existing DOM", () => {
      const node = renderer.getNodeForMorph(submorph2),
            submorph2B = morph({
              name: "submorph1", extent: pt(100,100), position: pt(10,10), fill: Color.red,
              submorphs: [{name: "submorph2", extent: pt(20,20), position: pt(5,10), fill: Color.green}]
            });
      submorph2.remove();
      world.addMorph(submorph2B);
      renderer.renderWorld();

      const nodeB = renderer.getNodeForMorph(submorph2B);
      expect(node).equals(nodeB, "rendering reuses existing DOM nodes");
    });

  });

  describe("morph lookup", () => {

    it("get() finds a morph by name", () => {
      expect(world.get("submorph2")).equals(submorph2);
      expect(submorph2.get("submorph3")).equals(submorph3);
      submorph2.remove();
      expect(submorph2.get("submorph3")).equals(null);
    });

    it("allows double naming", () => {
      submorph1.submorphs = [{name: "a morph"},{name: "a morph", submorphs: [{name: 'another morph'}]},{name: "a morph"}]
      var m = world.get('another morph');
      expect(m.owner).equals(submorph1.submorphs[1]);
      expect(m.get("a morph")).equals(submorph1.submorphs[0]);
    });

    it("get() uses toString", () => {
      submorph3.toString = () => "oink"
      expect(world.get("oink")).equals(submorph3);
    });

    it("get() works with RegExp", () => {
      expect(world.get(/rph3/)).equals(submorph3);
    });

  });

  describe("shapes", () => {

    it("shape influences node style", () => {
      const style = renderer.getNodeForMorph(ellipse).style;
      expect(style.borderRadius).match(/50px/);
      expect(style.position).equals("absolute");
    });

    it("morph type influences node type", () => {
      expect(ellipse._nodeType).equals("div");
      expect(image._nodeType).equals("img");
    });

    it("morph type influences node attributes", () => {
      const ellipseNode = renderer.getNodeForMorph(ellipse),
            imageNode = renderer.getNodeForMorph(image);
      expect(ellipseNode).not.to.have.property('src');
      expect(imageNode).to.have.property('src');
    });

    it("shape translates morph attributes to style", () => {
      expect(ellipse.shape()).deep.property("style.borderRadius").match(/50px/);
      ellipse.extent = pt(200, 100);
      expect(ellipse.shape()).deep.equals({style: {borderRadius: "200px/100px"}});
    });
  });

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-


  describe("geometric transformations", () => {

    it("localizes position", function() {
        var morph1 = morph(), morph2 = morph();
        world.addMorph(morph1);
        morph1.addMorph(morph2);
        morph2.position = pt(10,10);
        expect(pt(0,0)).equals(morph2.localize(pt(10,10)));
    });

  });

  describe("contains point", () => {

    it("testMorphsContainingPoint", function() {
      world.submorphs = [];
      var morph1 =      morph({position: pt(0, 0), extent: pt(100, 100), fill: Color.red}),
          submorph =    morph({position: pt(20, 20), extent: pt(30, 30), fill: Color.green}),
          subsubmorph = morph({position: pt(25, 25), extent: pt(5, 5), fill: Color.blue}),
          morph2 =      morph({position: pt(48, 48), extent: pt(100, 100), fill: Color.yellow});

      world.addMorph(morph1)
      morph1.addMorph(submorph)
      submorph.addMorph(subsubmorph)
      world.addMorph(morph2)

      var result, expected;

      result = morph1.morphsContainingPoint(pt(-1,-1));
      expect(0).equals(result.length,'for ' + pt(-1,-1));

      result = morph1.morphsContainingPoint(pt(1,1));
      expect(1).equals(result.length,'for ' + pt(1,1));
      expect(morph1).equals(result[0],'for ' + pt(1,1));

      result = morph1.morphsContainingPoint(pt(40,40));
      expect(2).equals(result.length,'for ' + pt(40,40));
      expect(submorph).equals(result[0]);
      expect(morph1).equals(result[1]);

      result = morph1.morphsContainingPoint(pt(45,45));
      expect(3).equals(result.length,'for ' + pt(45,45));
      expect(subsubmorph).equals(result[0]);
      expect(submorph).equals(result[1]);
      expect(morph1).equals(result[2]);

      result = world.morphsContainingPoint(pt(48,48));
      expect(5).equals(result.length,'for ' + pt(48,48));
      expect(morph2).equals(result[0]);
      expect(subsubmorph).equals(result[1]);
      expect(submorph).equals(result[2]);
      expect(morph1).equals(result[3]);
      expect(world).equals(result[4]);
    });

    it("testMorphsContainingPointWithAddMorphFront", function() {
        var morph1 = morph({position: pt(0, 0), extent: pt(100, 100)}),
            morph2 = morph({position: pt(0, 0), extent: pt(100, 100)});

        world.addMorph(morph1);
        world.addMorphBack(morph2);

        var result = world.morphsContainingPoint(pt(1,1));
        expect(3).equals(result.length);

        expect(morph1).equals(result[0],'for ' + pt(1,1));
        expect(morph2).equals(result[1],'for ' + pt(1,1));
    });

    it("testMorphsContainingPointDoesNotIncludeOffsetedOwner", function() {
      world.submorphs = [];
      var owner = morph({name: 'owner', position: pt(0, 0), extent: pt(100, 100), fill: Color.red}),
          submorph = morph({name: 'submorph', position: pt(110, 10), extent: pt(90, 90), fill: Color.green}),
          other = morph({name: 'other', position: pt(100, 0), extent: pt(100, 100), fill: Color.blue});

      world.addMorph(owner)
      owner.addMorph(submorph)
      world.addMorphBack(other)

      var result = world.morphsContainingPoint(pt(150,50));
      expect(3).equals(result.length,'for ' + pt(150,50));
      expect(world).equals(result[2],'for 2');
      expect(other).equals(result[1],'for 1');
      expect(submorph).equals(result[0],'for 0');
    });

  });

  describe("bounds", () => {

    it("bounds includes submorphs", () => {
      world.submorphs = [];
      var morph1 =      morph({position: pt(0, 0), extent: pt(25,25), fill: Color.red}),
          submorph =    morph({position: pt(20, 20), extent: pt(30, 30), fill: Color.green}),
          subsubmorph = morph({position: pt(20, 30), extent: pt(5, 5), fill: Color.blue});
      world.addMorph(morph1);
      morph1.addMorph(submorph);
      submorph.addMorph(subsubmorph);

      expect(morph1.bounds()).equals(new Rectangle(0,0,50,55))
    });

    it("testMorphBounds", function() {
      world.submorphs = [];
      var morph1 = morph(),
          morph2 = morph();

      world.addMorph(morph1);
      morph1.addMorph(morph2);
      morph1.setBounds(rect(100, 100, 40, 40));
      morph2.setBounds(rect(20, 10, 40, 40));
      morph2.submorphBounds(morph1.getTransform())
      expect(rect(100, 100, 60, 50)).equals(morph1.bounds());
    });

    it("testMorphBoundsChangeOnExtentPositionScaleRotationTransformChanges", function() {
      var m = morph();
      m.setBounds(rect(100, 100, 40, 40));
      expect(rect(100, 100, 40, 40)).equals(m.bounds(),"setBounds");
      m.extent = pt(50,50);
      expect(rect(100, 100, 50, 50)).equals(m.bounds(),"setExtent");
      m.position = pt(150,50);
      expect(rect(150, 50, 50, 50)).equals(m.bounds(),"setPosition");
      m.scale = 2;
      expect(rect(150, 50, 100, 100)).equals(m.bounds(),"setScale");
      m.setTransform(new Transform(pt(0,0)));
      expect(rect(0,0 , 50, 50)).equals(m.bounds(),"setTransform");
      m.rotateBy(num.toRadians(45));
      expect(m.bounds().x).closeTo(-35.36, 0.1)
      expect(m.bounds().y).closeTo(0, 0.1)
      expect(m.bounds().width).closeTo(70.71, 0.1)
      expect(m.bounds().height).closeTo(70.71, 0.1)
    });

    xit("testBorderWidthDoesNotAffectsBounds", function() {
      var m = morph();
      m.setBounds(rect(100, 100, 40, 40));
      m.setBorderWidth(4);
      expect(rect(100, 100, 40, 40)).equals(m.bounds());
    });

    it("testSubmorphsAffectBounds", function() {
      var morph1 = morph(),
          morph2 = morph();
      morph1.setBounds(rect(100, 100, 40, 40));
      expect(rect(100, 100, 40, 40)).equals(morph1.bounds());
      morph2.setBounds(rect(-10,0, 20, 50));
      morph1.addMorph(morph2);
      expect(rect(90, 100, 50, 50)).equals(morph1.bounds());
      morph2.remove();
      expect(rect(100, 100, 40, 40)).equals(morph1.bounds());
    });

  });


});
