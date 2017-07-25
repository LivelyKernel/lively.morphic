/*global System,WeakMap,FormData,fetch,DOMParser*/
import { Rectangle, Color, pt } from "lively.graphics";
import { arr, fun, obj, promise } from "lively.lang";
import { once, signal } from "lively.bindings";
import { Morph, inspect, config, MorphicEnv } from "./index.js";
import { Tooltip, TooltipViewer } from './tooltips.js';

import { loadMorphFromSnapshot } from "./serialization.js";
import { loadObjectFromPartsbinFolder } from "./partsbin.js";
import { uploadFile } from "./events/html-drop-handler.js";
import worldCommands from "./world-commands.js";
import { loadWorldFromURL, loadWorld } from "./world-loading.js";

import { UserUI } from "lively.user/morphic/user-ui.js";

export class World extends Morph {
  
  static get properties() {
    return {

      resizePolicy : {
        doc: "how the world behaves on window size changes 'elastic': resizes to window extent, 'static': leaves its extent unchanged",
        defaultValue: 'elastic',
        after: ["clipMode"],
        set(val) {
          this.setProperty("resizePolicy", val);
          this.clipMode = val === "static" ? "visible" : "hidden";
          if (val == "elastic") this.execCommand("resize to fit window");
        }
      },

      showsUserFlap: {
        defaultValue: true,
        set(bool) {          
          this.setProperty("showsUserFlap", bool);
          System.import("lively.user/morphic/user-ui.js")
            .then(userUI => userUI.UserUI[bool ? "showUserFlap" : "hideUserFlap"](this));
        }
      },

      styleSheets: {
        initialize() {
          this.execCommand('install themes');
        }
      }

    };
  }
  
  static defaultWorld() { return MorphicEnv.default().world; }

  static async loadWorldFromURL(url, oldWorld = this.defaultWorld(), options = {}) {
    return loadWorldFromURL(url, oldWorld, options);
  }

  static async loadWorld(newWorld, oldWorld = this.defaultWorld(), options = {}) {
    return loadWorld(newWorld, oldWorld, options);
  }

  constructor(props) {
    super(props);
    this._renderer = null; // assigned in rendering/renderer.js
    this._tooltipViewer = new TooltipViewer(this);
  }

  __deserialize__(snapshot, objRef) {
    super.__deserialize__(snapshot, objRef);
    this._renderer = null;
    this._tooltipViewer = new TooltipViewer(this);
  }

  __additionally_serialize__(snapshot, objRef, pool, addFn) {
    super.__additionally_serialize__(snapshot, objRef, pool, addFn);
    // remove epi morphs
    if (snapshot.props.submorphs) {
      let submorphs = snapshot.props.submorphs.value;
      for (let i = submorphs.length; i--; ) {
        let {id} = submorphs[i];
        if (pool.refForId(id).realObj.isHand)
          arr.removeAt(submorphs, i);
      }
    }
  }

  get isWorld() { return true }

  render(renderer) { return renderer.renderWorld(this); }

  get draggable() { return true; }
  set draggable(_) {}
  get grabbable() { return false; }
  set grabbable(_) {}

  existingHandForPointerId(pointerId) {
    return this.submorphs.find(m => m instanceof Hand && m.pointerId === pointerId);
  }

  handForPointerId(pointerId) {
    return this.existingHandForPointerId(pointerId)
        || this.addMorph(new Hand(pointerId), this.submorphs[0]);
  }

  removeHandForPointerId(pointerId) {
    let hand = this.existingHandForPointerId(pointerId);
    if (hand && this.hands.length > 1) hand.remove();
  }

  world() { return this }

  makeDirty() {
    if (this._dirty) return;
    this._dirty = true;
    let r = this.env.renderer;
    r && r.renderLater();
  }

  get hands() {
    return arr.sortBy(this.submorphs.filter(ea => ea.isHand), ea => ea.pointerId);
  }

  get firstHand() { return this.hands[0]; }

  activeWindow() { return this.getWindows().reverse().find(ea => ea.isActive()); }
  getWindows() { return this.submorphs.filter(ea => ea.isWindow); }

  activePrompt() { return this.getPrompts().reverse().find(ea => ea.isActive()); }
  getPrompts() { return this.submorphs.filter(ea => ea.isPrompt); }

  openInWindow(morph, opts = {title: morph.name, name: "window for " + morph.name}) {
    let win = this.execCommand('create window', {
      ...opts,
      extent: morph.extent.addXY(0, 25),
      targetMorph: morph
    }).openInWorld();
    win.ensureNotOverTheTop();
    return win;
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // user related
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  getCurrentUser() {
    if (!lively.user) return null;
    let reg = lively.user.UserRegistry.current;
    return reg.loadUserFromLocalStorage(config.users.authServerURL);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // events
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  get focusedMorph() {
    var focused = this.env.eventDispatcher.eventState.focusedMorph;
    return focused && focused.world() === this ? focused : this;
  }

  onMouseMove(evt) {
    evt.hand && evt.hand.update(evt);
    this._tooltipViewer.mouseMove(evt);
  }

  onMouseDown(evt) {
    var target = evt.state.clickedOnMorph,
        isCommandKey = evt.isCommandKey(),
        isShiftKey = evt.isShiftDown(),
        activeWindow = this.activeWindow();

    if (activeWindow && target == this) activeWindow.deactivate();

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // halo activation + removal
    // note that the logic for cycling halos from morph to underlying morph is
    // implemented in Halo>>onMouseDown
    var haloTarget;
    if (isCommandKey && !target.isHalo) {
      var morphsBelow = evt.world.morphsContainingPoint(evt.position),
          morphsBelowTarget = morphsBelow.slice(morphsBelow.indexOf(target));
      morphsBelow = morphsBelow.filter(ea => ea.halosEnabled);
      morphsBelowTarget = morphsBelowTarget.filter(ea => ea.halosEnabled);
      haloTarget = morphsBelowTarget[0] || morphsBelow[0];
    }
    if (isShiftKey && !target.isHaloItem && haloTarget &&
         evt.halo && evt.halo.borderBox != haloTarget) {
       evt.halo.addMorphToSelection(haloTarget);
       return;
    }
    var removeHalo = evt.halo && !evt.targetMorphs.find(morph => morph.isHaloItem),
        removeLayoutHalo = evt.layoutHalo && !evt.targetMorphs.find(morph => morph.isHaloItem),
        addHalo = (!evt.halo || removeHalo) && haloTarget;
    if (removeLayoutHalo) evt.layoutHalo.remove();
    if (removeHalo) evt.halo.remove();
    if (addHalo) { evt.stop(); this.showHaloFor(haloTarget, evt.domEvt.pointerId); return; }
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

    if (evt.state.menu) evt.state.menu.remove();

    this._tooltipViewer.mouseDown(evt);
  }

  onMouseUp(evt) {
    if (evt.isCommandKey()/* || evt.isShiftDown()*/) evt.stop();
    if (evt.isAltDown() && config.altClickDefinesThat) {
      var target = this.morphsContainingPoint(evt.position)[0];
      // FIXME currently delayed to overwrite that in old morphic
      setTimeout(() => System.global.that = target, 100);
      target.show();
      evt.stop();
      console.log(`Set global "that" to ${target}`);
      return;
    }
  }

  onLongClick(evt) {
    var target = evt.state.prevClick.clickedOnMorph;
    var haloTarget;

    var morphsBelow = evt.world.morphsContainingPoint(evt.position),
        morphsBelowTarget = morphsBelow.slice(morphsBelow.indexOf(target));
    morphsBelow = morphsBelow.filter(ea => ea.halosEnabled);
    morphsBelowTarget = morphsBelowTarget.filter(ea => ea.halosEnabled);
    haloTarget = morphsBelowTarget[0] || morphsBelow[0];

    var removeHalo = evt.halo && !evt.targetMorphs.find(morph => morph.isHaloItem),
        removeLayoutHalo = evt.layoutHalo && !evt.targetMorphs.find(morph => morph.isHaloItem),
        addHalo = (!evt.halo || removeHalo) && haloTarget;
    if (removeLayoutHalo) evt.layoutHalo.remove();
    if (removeHalo) evt.halo.remove();
    if (addHalo) { evt.stop(); this.showHaloFor(haloTarget, evt.domEvt.pointerId); return; }
  }

  onMouseWheel(evt) {
    // When holding shift pressed you can scroll around in the world without
    // scrolling an individual clipped morph that might be below the mouse cursor
    if (evt.isShiftDown()) {
      window.scrollBy(-evt.domEvt.wheelDeltaX, -evt.domEvt.wheelDeltaY)
      evt.stop();
    }
  }

  onDragStart(evt) {
     if (evt.leftMouseButtonPressed()) {
       this.selectionStartPos = evt.positionIn(this);
       this.morphSelection = this.addMorph({
          isSelectionElement: true,
          position: this.selectionStartPos, extent: evt.state.dragDelta,
          fill: Color.gray.withA(.2),
          borderWidth: 2, borderColor: Color.gray
       });
       this.selectedMorphs = {};
     }
  }

  onDrag(evt) {
    if (this.morphSelection) {
      const selectionBounds = Rectangle.fromAny(evt.position, this.selectionStartPos)
       this.morphSelection.setBounds(selectionBounds);
       this.submorphs.forEach(c => {
           if (c.isSelectionElement || c.isHand) return;
           const candidateBounds = c.bounds(),
                 included = selectionBounds.containsRect(candidateBounds);

           if (!this.selectedMorphs[c.id] && included) {
              this.selectedMorphs[c.id] = this.addMorph({
                  isSelectionElement: true,
                  bounds: candidateBounds,
                  borderColor: Color.red,
                  borderWidth: 1,
                  fill: Color.transparent
              }, this.morphSelection);
           }
           if (this.selectedMorphs[c.id] && !included) {
              this.selectedMorphs[c.id].remove();
              delete this.selectedMorphs[c.id];
           }
       })
    }
  }

  onDragEnd(evt) {
     if (this.morphSelection) {
       this.morphSelection.fadeOut(200);
       obj.values(this.selectedMorphs).map(m => m.remove());
       this.showHaloForSelection(Object.keys(this.selectedMorphs)
                                       .map(id => this.getMorphWithId(id)));
       this.selectedMorphs = {};
       this.morphSelection = null;
     }
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // html5 drag - drop

  async ensureUploadIndicator() {
    if (!this._cachedDragIndicator)
      this._cachedDragIndicator = loadObjectFromPartsbinFolder("upload-indicator");
    let i = await this._cachedDragIndicator;
    if (!i.world()) i.openInWorld();
    fun.debounceNamed("remove-upload-indicator", 1000, () => {
      this.nativeDrop_removeUploadIndicator();
    })();
  }

  nativeDrop_removeUploadIndicator() {
    if (this._cachedDragIndicator)
      this._cachedDragIndicator.then(i => i.remove());
  }

  onNativeDragover(evt) {
    if (evt.targetMorph === this)
      this.nativeDrop_ensureUploadIndicator();
  }

  async onNativeDrop(evt) {
    /*global show, inspect*/
    this.nativeDrop_removeUploadIndicator();

    let {domEvt} = evt,
        {files, items} = domEvt.dataTransfer,
        baseURL = document.origin;

    if (files.length) {
      let really = await this.confirm(
        `Upload ${files.length} file${files.length > 1 ? "s": ""}?`);

      if (!really) return;

      let fd = new FormData()
      for (let i = 0; i < files.length; i++)
        fd.append('file', files[i], files[i].name);

      let res, answerText;
      try {
        res = await fetch("/upload", {method: 'POST', body: fd});
        answerText = await res.text();

      } catch (err) {
        return this.showError(`Upload failed: ${err.message}\n`);
      }

      if (!res.ok) {
        return this.showError(answerText || res.statusText);
      }
      try {
        let answer = JSON.parse(answerText);

        if (answer.status !== "done") {
          return this.setStatusMessage(`File upload failed: ${answer.status}`)
        }

        this.setStatusMessage(`Uploaded ${answer.uploadedFiles.length} file`)

        let files = answer.uploadedFiles.map(ea => {
          let res = lively.resources.resource(baseURL).join(ea.path);
          return {
            ...ea,
            url: res.url,
            name: res.name()
          }
        });
        let images = [], videos = [], others = [];
        for (let f of files) {
          if (f.type.startsWith("image/")) images.push(f);
          else if (f.type.startsWith("video")) videos.push(f);
          else others.push(f);
        }
        if (videos.length) {
          for (let v of videos) {
            let video = Object.assign(await loadObjectFromPartsbinFolder("video morph"), {
              videoURL: v.url,
              name: v.name
            }).openInWorld();
          }
        }
        if (images.length) {
          let openImages = true;
          // let openImages = await this.confirm(
          //   images.length > 1 ?
          //     `There were ${images.length} images uploaded. Open them?` :
          //     `There was 1 image uploaded. Open it?`);
          if (openImages) {
            images.forEach(ea => {
              let img = new Image({
                imageUrl: ea.url,
                autoResize: true,
                name: ea.name
              });
              img.whenLoaded().then(() => img.openInWorld());
            });
          }
        }
        if (others.length) {
          for (let file of others) {
            let open = await this.confirm(`open file ${file.name} (${file.type})?`);
            if (open) this.execCommand("open file", {url: file.url})
          }
        }
      } catch (err) { this.showError(err); }
      return;
    }

    // show(`
    //   ${domEvt.dataTransfer.files.length}
    //   ${domEvt.dataTransfer.items.length}
    //   ${domEvt.target}
    //   ${domEvt.dataTransfer.types}
    // `)

    let types = domEvt.dataTransfer.types;
    if (types.includes("text/html")) {
      let html = domEvt.dataTransfer.getData("text/html"),
          parsed = new DOMParser().parseFromString(html, "text/html"),
          imgs = parsed.querySelectorAll("img");
      // is it a dropped image?
      if (imgs.length === 1 && imgs[0].src && types.includes("text/uri-list")) {
        let url = imgs[0].src;
        let img = new Image({
          imageUrl: url,
          autoResize: true,
          name: arr.last(url.split("/"))
        });
        img.whenLoaded().then(() => img.openInWorld());
      } else {
        Object.assign(await loadObjectFromPartsbinFolder("html-morph"), {html})
          .openInWorld();
      }
      return;
    }

    for (let i = 0; i < domEvt.dataTransfer.items.length; i++) {
      let item = domEvt.dataTransfer.items[i];
      // console.log(`${item.kind} - ${item.type}`)
      if (item.kind === "file") {
        let f = item.getAsFile();
        let upload = await this.confirm(`Upload ${f.name}?`);
        if (upload) {
          let uploadedMorph = await uploadFile(f, f.type);
          uploadedMorph && uploadedMorph.openInWorld();
        }
      } else if (item.kind === "string") {
        // show({kind: item.kind, type: item.type})
        item.getAsString((s) => inspect(s));
      }
    }
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // menu
  menuItems() {
    return [
      {title: "World menu"},
      {command: "undo",                     target: this},
      {command: "redo",                     target: this},
      {isDivider: true},
      ["Debugging", [
        {command: "delete change history", target: this},
        {command: "fix font metric", target: this}
      ]],
      ["Tools", [
        {command: "open PartsBin",            target: this},
        {command: "open workspace",           target: this},
        {command: "open browser",             target: this},
        {command: "choose and browse module", target: this},
        {command: "open code search",         target: this},
        {command: "open file browser",         target: this},
        {command: "open shell workspace",     target: this}
      ]],
      {isDivider: true},
      {command: "run command",              target: this},
      {command: "select morph",             target: this},
      {command: "window switcher",          target: this},
      ["Resize",
         this.resizePolicy === "static" ? [
          {command: "resize to fit window", target: this},
          {command: "resize manually", target: this},
          ["switch to automatic resizing of world", () => this.resizePolicy = "elastic"]
         ] : [
           ["switch to manual resizing of world", () => this.resizePolicy = "static"]
         ]
      ],
      {command: "report a bug",          target: this},
      {isDivider: true},
      {command: "save world",          target: this},
      {command: "load world",          target: this},
    ];
  }

  openWorldMenu(evt, items) {
    var eventState =  this.env.eventDispatcher.eventState;
    if (eventState.menu) eventState.menu.remove();
    return eventState.menu = items && items.length ?
      this.execCommand("open menu at hand", {items, hand: (evt && evt.hand) || this.firstHand}) : null;
  }

  onWindowScroll(evt) {
    // rk 2017-07-02: Experimental, see evts/TextInput.js ensureBeingAtCursorOfText
    let {
      positionChangedTime,
      scrollLeftWhenChanged,
      scrollTopWhenChanged,
    } = evt.dispatcher.keyInputHelper.inputState;
    let docEl = document.documentElement;
    if (Date.now() - positionChangedTime < 500) {
      docEl.scrollLeft = scrollLeftWhenChanged;
      docEl.scrollTop = scrollTopWhenChanged;
      return;
    }

    this.setProperty("scroll", pt(docEl.scrollLeft, docEl.scrollTop));
    this._cachedWindowBounds = null;
    this.updateVisibleWindowMorphs(evt);
    this.onMouseMove(evt);
  }

  onWindowResize(evt) {
    this._cachedWindowBounds = null;
    if (this.resizePolicy === 'elastic')
      this.execCommand("resize to fit window");
    this.updateVisibleWindowMorphs(evt);
    for (let morph of this.submorphs)
      if (typeof morph.onWorldResize === "function")
        morph.onWorldResize(evt);
  }

  updateVisibleWindowMorphs(evt) {
    // Currently checks all morphs to see if an update is required.  Could
    // possibly be streamlined by having a discrete list of morphs to be updated
    // instead of traversing tree or moving to a CSS method if necessary.
    this.withAllSubmorphsDo(aMorph => {
      if (!aMorph.respondsToVisibleWindow) return;
      if (typeof aMorph.relayout !== 'function')
        return aMorph.showError(new Error(`${aMorph} listed as responding to visible window`
                                          + ` change, but has no relayout instruction`));
      aMorph.relayout(evt);
    });
  }

  async onPaste(evt) {
    try {
      let data = evt.domEvt.clipboardData;
      if (data.types.includes("application/morphic")) {
        evt.stop();
        let snapshots = JSON.parse(data.getData("application/morphic")),
            morphs = [];
        data.clearData()
        if (!Array.isArray(snapshots)) snapshots = [snapshots];
        for (let s of snapshots) {
          let morph = await loadMorphFromSnapshot(s);
          morph.openInWorld(evt.hand.position);
          if (s.copyMeta && s.copyMeta.offset) {
            let {x,y} = s.copyMeta.offset;
            morph.moveBy(pt(x,y));
          }
          morphs.push(morph);
        }
        this.showHaloFor(morphs);
      }
    } catch (e) {
      this.showError(e)
    }
  }

  relayCommandExecutionToFocusedMorph(evt) {
    // can be called from exec method of commands with 4. argument (evt)
    // Will try to invoke mapped a command triggered by evt in the focused
    // morph or one of its owners. This provides optional "bubble" semantics
    // for command invocation
    if (!evt) return null;
    let focused = this.focusedMorph,
        {command, morph} = arr.findAndGet(
      arr.without([focused, ...focused.ownerChain()], this),
      morph => arr.findAndGet(morph.keyhandlers, kh => {
        let command = kh.eventCommandLookup(morph, evt);
        return command ? {command, morph} : null;
      })) || {};
    return command ? morph.execCommand(command) : null;
  }

  get commands() { return worldCommands.concat(super.commands); }
  get keybindings() { return super.keybindings.concat(config.globalKeyBindings); }
  set keybindings(x) { super.keybindings = x }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // halos
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  halos() { return this.submorphs.filter(m => m.isHalo); }

  haloForPointerId(pointerId) {
    return this.submorphs.find(m => m.isHalo && m.state && m.state.pointerId === pointerId);
  }

  async showHaloFor(target, pointerId = this.firstHand && this.firstHand.pointerId, focus = true) {
    var halo = this.addMorph(this.execCommand("open halo", {pointerId, target}));
    if (focus) halo.focus()
    return halo;
  }

  async showHaloForSelection(selection, pointerId) {
    return selection.length > 0 && await this.showHaloFor(selection, pointerId);
  }

  layoutHaloForPointerId(pointerId = this.firstHand && this.firstHand.pointerId) {
    return this.submorphs.find(m => m.isLayoutHalo && m.state && m.state.pointerId === pointerId);
  }

  showLayoutHaloFor(morph, pointerId = this.firstHand && this.firstHand.pointerId) {
    return this.addMorph(morph.layout.inspect(pointerId));
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  visibleBounds () {
    // the bounds call seems to slow down halos...
    if (!this.env.renderer) return this.innerBounds();
    return this.windowBounds().intersection(this.innerBounds());
  }

  windowBounds(optWorldDOMNode) {
    if (this._cachedWindowBounds) return this._cachedWindowBounds;
    var {window} = this.env.domEnv,
        scale = 1 / this.scale,
        x = window.scrollX * scale,
        y = window.scrollY * scale,
        width = (window.innerWidth || this.width) * scale,
        height = (window.innerHeight || this.height) * scale;
    return this._cachedWindowBounds = new Rectangle(x, y, width, height);
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // status messages
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  visibleStatusMessages() {
    return this.submorphs.filter(ea => ea.isStatusMessage)
  }

  visibleStatusMessagesFor(morph) {
    return this.submorphs.filter(ea => ea.isStatusMessage && ea.targetMorph === morph)
  }

  logErrorPreperation(err) {
    var stringified = String(err),
        stack = err.stack || "";
    if (stack && err.message !== err.stack) {
      stack = String(stack);
      var errInStackIdx = stack.indexOf(stringified);
      if (errInStackIdx === 0)
        stack = stack.slice(stringified.length);
      stringified += "\n" + stack;
    }
    return stringified;
  }

  logError(err) {
    this.setStatusMessage(this.logErrorPreperation(err), Color.red);
  }

  showError(err) { return this.logError(err); }

  showErrorFor(morph, err) {
    return this.setStatusMessageFor(morph, this.logErrorPreperation(err), Color.red);
  }

  setStatusMessageFor(morph, message, color, delay = 5000, props) {
    this.visibleStatusMessagesFor(morph).forEach(ea => ea.remove());
    var msgMorph = this.execCommand("create status message for morph", {morph, message, color, ...props});
    this.openStatusMessage(msgMorph, delay);
    msgMorph.targetMorph = morph;
    msgMorph.fadeIn(300);
    if (msgMorph.removeOnTargetMorphChange && morph.isText) {
      once(morph, "selectionChange", msgMorph, "fadeOut", {converter: () => 200});
    }
    return msgMorph;
  }

  setStatusMessage(message, color, delay = 5000, optStyle = {}) {
    // $world.setStatusMessage("test", Color.green)
    console[color == Color.red ? "error" : "log"](message);
    return config.verboseLogging ?
      this.openStatusMessage(this.execCommand("create status message", {message, color, ...optStyle}), delay) :
      null;
  }

  openLoadingIndicator(infoString) {
    return this.execCommand('open loading indicator', infoString)
  }

  openStatusMessage(statusMessage, delay) {
    // $world.setStatusMessage("test", Color.green)

    this.addMorph(statusMessage);

    if (statusMessage.slidable) {
      var messages = this.visibleStatusMessages();
      for (let m of messages) {
        if (messages.length <= (config.maxStatusMessages || 0)) break;
        if (m.stayOpen || !m.slidable) continue;
        m.remove();
        arr.remove(messages, m);
      }

      messages.forEach(async msg => {
        if(!msg.isMaximized && msg.slidable) {
          msg.slideTo(msg.position.addPt(pt(0, -statusMessage.extent.y - 10)))
        }
      });

      const msgPos = this.visibleBounds().bottomRight().addXY(-20, -20);
      statusMessage.align(statusMessage.bounds().bottomRight(), msgPos);
      statusMessage.topRight = msgPos.addPt(pt(0,40));
      statusMessage.animate({bottomRight: msgPos, duration: 500});
    }

    if (typeof delay === "number")
      setTimeout(() => statusMessage.stayOpen || statusMessage.fadeOut(), delay);

    return statusMessage;
  }

  async addProgressBar(opts = {}) {
    let {location = "center"} = opts,
        pBar = await loadObjectFromPartsbinFolder("progress bar");
    Object.assign(pBar, {progress: 0}, obj.dissoc(opts, ["location"]));
    this.addMorph(pBar);
    pBar.align(pBar[location], this.visibleBounds()[location]());
    return pBar;
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // dialogs
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  async openPrompt(promptMorph, opts = {requester: null, animated: false}) {
    var focused = this.focusedMorph, visBounds = this.visibleBounds();

    if (!promptMorph) {
      throw Error('Prompt can not be initialized! Did you forget to load lively.components?');
    }

    promptMorph.openInWorldNear(
      opts.requester ?
        visBounds.constrainPt(opts.requester.globalBounds().center()) :
        visBounds.center(), this);

    if (promptMorph.height > visBounds.height)
      promptMorph.height = visBounds.height - 5;

    if (typeof opts.customize === "function")
      opts.customize(promptMorph);

    if (opts.animated) {
      if (this.previousPrompt && this.previousPrompt.world()) {
        this.previousPrompt.transitionTo(promptMorph);
      } else {
        promptMorph.openInWorld(promptMorph.globalPosition);
      }
    }
    this.previousPrompt = promptMorph;
    return promise.finally(promptMorph.activate(opts), () => focused && focused.focus());
  }

  inform(label = "no message", opts = {fontSize: 16, requester: null, animated: true}) {
    return this.openPrompt(this.execCommand('create inform prompt', {label, ...opts}), opts);
  }

  prompt(label, opts = {requester: null, input: "", historyId: null, useLastInput: false}) {
    // await this.world().prompt("test", {input: "123"})
    // options = {
    //   input: STRING, -- optional, prefilled input string
    //   historyId: STRING, -- id to identify the input history for this prompt
    //   useLastInput: BOOLEAN -- use history for default input?
    // }
    return this.openPrompt(this.execCommand('create text prompt', {label, ...opts}), opts);
  }

  editPrompt(label, opts = {requester: null, input: "", historyId: null, useLastInput: false, textStyle: null, mode: null, evalEnvironment: null}) {
    return this.openPrompt(this.execCommand('create edit prompt', {label, ...opts}), opts);
  }

  passwordPrompt(label, opts = {requester: null, input: ""}) {
    // await this.world().passwordPrompt("secret")
    return this.openPrompt(this.execCommand("create password prompt", {label, ...opts}), opts);
  }

  confirm(label, opts = {requester: null, animated: true}) {
    // await this.world().confirm("test")
    return this.openPrompt(this.execCommand('create confirm prompt', {label, ...opts}), opts);
  }

  multipleChoicePrompt(label, opts = {requester: null, animated: true, choices: []}) {
    // await this.world().multipleChoicePrompt("test", {choices: ["1","2","3","4"]})
    return this.openPrompt(this.execCommand('create multiple choice prompt', {label, ...opts}), opts);
  }

  listPrompt(label = "", items = [], opts = {requester: null, onSelection: null, preselect: 0}) {
    return this.openPrompt(this.execCommand("create list command", {
      filterable: false, padding: Rectangle.inset(3),
      label, items, ...opts}), opts);
  }

  filterableListPrompt(
    label = "",
    items = [],
    opts = {
      requester: null, onSelection: null,
      preselect: 0, multiSelect: false,
      historyId: null,
      fuzzy: false,
      actions: ["default"],
      selectedAction: "default",
      theme: 'dark',
      // sortFunction: (parsedInput, item) => ...
      // filterFunction: (parsedInput, item) => ...
    }) {

    if (opts.prompt) {
      var list = opts.prompt.get("list");
      list.items = items;
      list.selectedIndex = opts.preselect || 0;
      return this.openPrompt(opts.prompt, opts);
    }

    return this.openPrompt(this.execCommand("create list prompt", {
      filterable: true, padding: Rectangle.inset(3),
      label, items, ...opts}), opts);
  }

  editListPrompt(label = "", items = [], opts = {requester: null, multiSelect: true, historyId: null}) {
    return this.openPrompt(this.execCommand("create edit list prompt", {
      label, multiSelect: true, items, padding: Rectangle.inset(3), ...opts}), opts);
  }
}

export class Hand extends Morph {

  static get properties() {
    return {
      fill: {defaultValue: Color.orange},
      extent: {defaultValue: pt(4,4)},
      reactsToPointer: {defaultValue: false},
      _grabbedMorphProperties: {
        serialize: false,
        initialize: function() { this._grabbedMorphProperties = new WeakMap(); }
      }
    }
  }
  constructor(pointerId) {
    super({pointerId});
  }

  __deserialize__(snapshot, objRef) {
    super.__deserialize__(snapshot, objRef);
    this.reset();
  }

  reset() {
    // stores properties of morphs while those are being carried
    this._grabbedMorphProperties = new WeakMap();
  }

  get isHand() { return true }

  get pointerId() { return this.getProperty("pointerId"); }
  set pointerId(id) { this.setProperty("pointerId", id); }

  get draggable() { return false; }
  set draggable(_) {}
  get grabbable() { return false; }
  set grabbable(_) {}

  get grabbedMorphs() { return this.submorphs; }

  carriesMorphs() { return !!this.grabbedMorphs.length; }

  morphsContainingPoint(point, list) { return list }

  update(evt) {
    this.position = evt.position;
    this.carriesMorphs() && evt.halo && evt.halo.grabHalo().update();
  }

  async cancelGrab(animate = true, causingEvent) {
    if (!this.grabbedMorphs.length) return;
    this.env.eventDispatcher.cancelGrab(this, causingEvent);
    let anims = []
    for (let m of this.grabbedMorphs) {
      let {prevOwner, prevIndex, prevPosition, pointerAndShadow} =
        this._grabbedMorphProperties.get(m) || {};
      Object.assign(m, pointerAndShadow);
      if (!prevOwner) { m.remove(); continue; }
      prevOwner.addMorphAt(m, prevIndex);
      if (animate) anims.push(m.animate({position: prevPosition}));
      else m.position = prevPosition;
    }
    return anims.length ? Promise.all(anims) : null;
  }

  grab(morph) {
    if (obj.isArray(morph)) return morph.forEach(m => this.grab(m));
    this._grabbedMorphProperties.set(morph, {
      prevOwner: morph.owner,
      prevPosition: morph.position,
      prevIndex: morph.owner ? morph.owner.submorphs.indexOf(morph) : -1,
      pointerAndShadow: obj.select(morph, ["dropShadow", "reactsToPointer"])
    })
    // So that the morphs doesn't steal events
    morph.reactsToPointer = false;
    morph.dropShadow = true;
    this.addMorph(morph);
    signal(this, "grab", morph);
  }

  dropMorphsOn(dropTarget) {
    this.grabbedMorphs.forEach(morph => {
      try {
        dropTarget.addMorph(morph);
        let {pointerAndShadow} = this._grabbedMorphProperties.get(morph) || {}
        Object.assign(morph, pointerAndShadow);
        signal(this, "drop", morph);
        morph.onBeingDroppedOn(this, dropTarget);
      } catch (err) {
        console.error(err);
        this.world().showError(`Error dropping ${morph} onto ${dropTarget}:\n${err.stack}`);
        if (morph.owner !== dropTarget)
          this.world().addMorph(dropTarget);
      }
    });
  }

  findDropTarget(position = this.position, grabbedMorphs, optFilterFn) {
    let morphs = this.world().morphsContainingPoint(position),
        filterFn = typeof optFilterFn === "function"
          ? (m, i) =>
              !this.isAncestorOf(m) &&
              m.acceptsDrops && !grabbedMorphs.includes(m)
              && grabbedMorphs.every(ea => ea.wantsToBeDroppedOn(m)) &&
              optFilterFn(m, i)
          : m => !this.isAncestorOf(m) && m.acceptsDrops;
    return morphs.find(filterFn);
  }

}
