import {
    clamp, snapGrid, dist, circlesOverlap, rectsOverlap,
    resolveOverlap, anyWiresCross, PORT_RADIUS, MAX_WIRE_LENGTH,
    raycastObjects, snapAngle
} from './utils.js';
import {
    Obj, AND, OR, XOR, NAND, NOR, XNOR, NOT,
    Lever, Battery, Button, Lamp
} from './components.js';
import { Wire } from './wire.js';

// ---------- app state ----------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const objects = [
    new Obj(40, 40),
    new Lever(150, 40),
    new Battery(250, 40),
    new Button(340, 40),
    new NOT(440, 40),
    new AND(40, 140),
    new OR(150, 140),
    new XOR(260, 140),
    new NAND(370, 140),
    new NOR(480, 140),
    new XNOR(590, 140),
    new Lamp(40, 240),
    new Lamp(120, 240)
];

const wires = [
    new Wire(200, 350, 350, 350),
    new Wire(400, 380, 520, 320),
    new Wire(150, 420, 280, 440),
    new Wire(450, 450, 600, 420)
];

let drag = null;
let mouse = { x: 0, y: 0 };
let hoveredLever = null;
let hoveredButton = null;
let hoveredJoint = null;
let lastTime = performance.now();
let shiftHeld = false;
let eHeld = false;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function allPorts() {
    const list = [];
    for (const o of objects) list.push(...o.getPorts());
    for (const w of wires) list.push(...w.getPorts());
    return list;
}

function findPortAt(px, py) {
    for (let i = wires.length - 1; i >= 0; i--) {
        for (const p of wires[i].getPorts()) {
            if (p.contains(px, py)) return p;
        }
    }
    return null;
}

function findObjectPortAt(px, py) {
    for (let i = objects.length - 1; i >= 0; i--) {
        for (const p of objects[i].getPorts()) {
            if (p.contains(px, py)) return p;
        }
    }
    return null;
}

function findObjectAt(px, py) {
    for (let i = objects.length - 1; i >= 0; i--) {
        if (objects[i].contains(px, py)) return objects[i];
    }
    return null;
}

function findWireBodyAt(px, py) {
    for (let i = wires.length - 1; i >= 0; i--) {
        if (wires[i].hitBody(px, py)) return wires[i];
    }
    return null;
}

function getDirectConnectedGroup(start) {
    const group = new Set([start]);
    const queue = [start];

    while (queue.length > 0) {
        const obj = queue.shift();
        for (const port of obj.getPorts()) {
            if (!port.connectedTo) continue;
            const other = port.connectedTo.owner;
            if (!(other instanceof Obj)) continue;
            if (group.has(other)) continue;
            group.add(other);
            queue.push(other);
        }
    }

    return [...group];
}

function getWireConnectedGroup(start) {
    const group = new Set([start]);
    const visitedPorts = new Set();
    const queue = [...start.getPorts()];

    while (queue.length > 0) {
        const port = queue.shift();
        if (visitedPorts.has(port)) continue;
        visitedPorts.add(port);

        if (port.connectedTo && !visitedPorts.has(port.connectedTo)) {
            queue.push(port.connectedTo);
        }

        if (port.owner.isWire) {
            for (const p of port.owner.getPorts()) {
                if (!visitedPorts.has(p)) queue.push(p);
            }
        }

        if (port.owner instanceof Obj) {
            group.add(port.owner);
            for (const p of port.owner.getPorts()) {
                if (!visitedPorts.has(p)) queue.push(p);
            }
        }
    }

    return [...group];
}

function buildDragGroup(start, withShift) {
    const groupSet = new Set(getDirectConnectedGroup(start));

    if (withShift) {
        const seed = [...groupSet];
        for (const o of seed) {
            for (const w of getWireConnectedGroup(o)) {
                groupSet.add(w);
            }
        }
        const seed2 = [...groupSet];
        for (const o of seed2) {
            for (const d of getDirectConnectedGroup(o)) {
                groupSet.add(d);
            }
        }
    }

    return [...groupSet];
}

function getObjectsConnectedToWire(wire) {
    const group = new Set();
    const visitedPorts = new Set();
    const queue = [...wire.getPorts()];

    while (queue.length > 0) {
        const port = queue.shift();
        if (visitedPorts.has(port)) continue;
        visitedPorts.add(port);

        if (port.connectedTo && !visitedPorts.has(port.connectedTo)) {
            queue.push(port.connectedTo);
        }

        if (port.owner.isWire) {
            for (const p of port.owner.getPorts()) {
                if (!visitedPorts.has(p)) queue.push(p);
            }
        }

        if (port.owner instanceof Obj) {
            group.add(port.owner);
            for (const p of port.owner.getPorts()) {
                if (!visitedPorts.has(p)) queue.push(p);
            }
        }
    }

    return [...group];
}

function getWiresTouchingGroup(group) {
    const set = new Set(group);
    const result = [];
    for (const w of wires) {
        for (const p of w.getPorts()) {
            if (p.connectedTo && set.has(p.connectedTo.owner)) {
                result.push(w);
                break;
            }
        }
    }
    return result;
}

function tryConnect(port, allowObjObj = true) {
    if (port.isConnected) return false;
    for (const other of allPorts()) {
        if (other === port) continue;
        if (other.owner === port.owner) continue;
        if (other.isConnected) continue;
        if (port.type === other.type) continue;
        const bothObj = (port.owner instanceof Obj) && (other.owner instanceof Obj);
        if (bothObj && !allowObjObj) continue;
        if (circlesOverlap(port.x, port.y, port.radius, other.x, other.y, other.radius)) {
            return port.connect(other, canvas);
        }
    }
    return false;
}

function tryConnectObjectPorts(obj, allowObjObj = false) {
    let connected = false;
    for (const port of obj.getPorts()) {
        if (tryConnect(port, allowObjObj)) connected = true;
    }
    return connected;
}

function validateObjObjConnections() {
    for (const o of objects) {
        for (const port of o.getPorts()) {
            if (!port.connectedTo) continue;
            if (!(port.connectedTo.owner instanceof Obj)) continue;
            if (dist(port.x, port.y, port.connectedTo.x, port.connectedTo.y) > PORT_RADIUS * 2) {
                port.disconnect();
            }
        }
    }
}

function expandGroupForDirectLinks(group) {
    const set = new Set(group);
    let changed = true;
    while (changed) {
        changed = false;
        for (const o of [...set]) {
            for (const d of getDirectConnectedGroup(o)) {
                if (!set.has(d)) {
                    set.add(d);
                    changed = true;
                }
            }
        }
    }
    return [...set];
}

function enforceWireLengthForObject(obj) {
    for (const port of obj.getPorts()) {
        if (!port.connectedTo) continue;
        const wirePort = port.connectedTo;
        if (!wirePort.owner.isWire) continue;

        const wire = wirePort.owner;
        const far = wirePort === wire.inputPort ? wire.outputPort : wire.inputPort;

        let dx = port.x - far.x;
        let dy = port.y - far.y;
        let len = Math.hypot(dx, dy);
        if (len <= MAX_WIRE_LENGTH) continue;

        const s = MAX_WIRE_LENGTH / len;
        const targetX = far.x + dx * s;
        const targetY = far.y + dy * s;

        obj.x += targetX - port.x;
        obj.y += targetY - port.y;
        obj.x = clamp(obj.x, obj.w, canvas.width);
        obj.y = clamp(obj.y, obj.h, canvas.height);
        obj.updatePorts();
    }
}

function applyGroupMove(group, dx, dy, lastPositions) {
    const groupSet = new Set(group);
    const lastMap = new Map(lastPositions.map(p => [p.obj, p]));

    for (const o of group) {
        o.x += dx;
        o.y += dy;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of group) {
        minX = Math.min(minX, o.x);
        minY = Math.min(minY, o.y);
        maxX = Math.max(maxX, o.x + o.w);
        maxY = Math.max(maxY, o.y + o.h);
    }
    let adjX = 0, adjY = 0;
    if (minX < 0) adjX = -minX;
    if (minY < 0) adjY = -minY;
    if (maxX > canvas.width) adjX = canvas.width - maxX;
    if (maxY > canvas.height) adjY = canvas.height - maxY;
    if (minX < 0 && maxX + adjX > canvas.width) adjX = -minX;
    if (minY < 0 && maxY + adjY > canvas.height) adjY = -minY;

    for (const o of group) {
        o.x += adjX;
        o.y += adjY;
    }

    for (const o of group) {
        for (const other of objects) {
            if (groupSet.has(other)) continue;
            if (rectsOverlap(o.x, o.y, o.w, o.h, other.x, other.y, other.w, other.h)) {
                resolveOverlap(o, other);
            }
        }
        o.x = clamp(o.x, o.w, canvas.width);
        o.y = clamp(o.y, o.h, canvas.height);
    }

    for (const o of group) o.updatePorts();
    for (const o of group) enforceWireLengthForObject(o);
    for (const o of group) o.updatePorts();

    for (const o of group) {
        for (const port of o.getPorts()) {
            if (!port.connectedTo) continue;
            if (!(port.connectedTo.owner instanceof Obj)) continue;
            const other = port.connectedTo.owner;
            if (!groupSet.has(other)) continue;
            const ddx = port.connectedTo.x - port.x;
            const ddy = port.connectedTo.y - port.y;
            if (Math.hypot(ddx, ddy) > 0.5) {
                o.x += ddx;
                o.y += ddy;
                o.updatePorts();
            }
        }
    }

    const groupWires = getWiresTouchingGroup(group);
    if (!anyWiresCross(groupWires, objects)) {
        return group.map(o => ({ obj: o, x: o.x, y: o.y }));
    }

    let lo = 0;
    let hi = 1;

    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        for (const o of group) {
            const last = lastMap.get(o);
            o.x = last.x + dx * mid;
            o.y = last.y + dy * mid;
        }

        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        for (const o of group) {
            minX = Math.min(minX, o.x);
            minY = Math.min(minY, o.y);
            maxX = Math.max(maxX, o.x + o.w);
            maxY = Math.max(maxY, o.y + o.h);
        }
        adjX = 0; adjY = 0;
        if (minX < 0) adjX = -minX;
        if (minY < 0) adjY = -minY;
        if (maxX > canvas.width) adjX = canvas.width - maxX;
        if (maxY > canvas.height) adjY = canvas.height - maxY;
        for (const o of group) {
            o.x += adjX;
            o.y += adjY;
        }
        for (const o of group) {
            for (const other of objects) {
                if (groupSet.has(other)) continue;
                if (rectsOverlap(o.x, o.y, o.w, o.h, other.x, other.y, other.w, other.h)) {
                    resolveOverlap(o, other);
                }
            }
            o.x = clamp(o.x, o.w, canvas.width);
            o.y = clamp(o.y, o.h, canvas.height);
            o.updatePorts();
        }

        if (anyWiresCross(getWiresTouchingGroup(group), objects)) {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    for (const o of group) {
        const last = lastMap.get(o);
        o.x = last.x + dx * lo;
        o.y = last.y + dy * lo;
    }
    for (const o of group) {
        o.x = clamp(o.x, o.w, canvas.width);
        o.y = clamp(o.y, o.h, canvas.height);
        o.updatePorts();
    }

    return group.map(o => ({ obj: o, x: o.x, y: o.y }));
}

function syncAllPorts() {
    for (const o of objects) o.updatePorts();
}

// ---------- signal evaluation (fixed for XNOR / inverting gates) ----------

function clearPower() {
    for (const p of allPorts()) {
        p.powered = false;
    }
}

function propagateWiresAndLinks() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 64) {
        changed = false;
        for (const p of allPorts()) {
            if (!p.powered) continue;
            if (p.connectedTo && !p.connectedTo.powered) {
                p.connectedTo.powered = true;
                changed = true;
            }
        }
        for (const w of wires) {
            if (w.inputPort.powered && !w.outputPort.powered) {
                w.outputPort.powered = true;
                changed = true;
            }
            if (w.outputPort.powered && !w.inputPort.powered) {
                w.inputPort.powered = true;
                changed = true;
            }
        }
    }
}

/**
 * Combinational evaluation that correctly handles inverting gates
 * (XNOR, NOT, NAND, NOR) and true→false transitions.
 *
 * Each pass:
 *  1. Snapshot desired output of every component from current input power
 *  2. Clear all power
 *  3. Apply desired values to component output ports
 *  4. Propagate through wires & connections
 * Repeat until stable (or max passes).
 */
function evaluateCircuit() {
    for (let pass = 0; pass < 32; pass++) {
        // Snapshot desired outputs from current input power states
        const desired = new Map();
        for (const o of objects) {
            if (!o.outputPort) continue;
            const before = o.outputPort.powered;
            o.evaluate();
            desired.set(o.outputPort, !!o.outputPort.powered);
            o.outputPort.powered = before;
        }

        clearPower();
        for (const [port, val] of desired) {
            port.powered = val;
        }
        propagateWiresAndLinks();

        // Stable if recomputing from the new inputs yields the same outputs
        let stable = true;
        for (const o of objects) {
            if (!o.outputPort) continue;
            const expected = desired.get(o.outputPort);
            const before = o.outputPort.powered;
            o.evaluate();
            const got = !!o.outputPort.powered;
            o.outputPort.powered = before;
            if (got !== expected) {
                stable = false;
                break;
            }
        }
        if (stable) break;
    }
}

// ---------- joint / wire helpers ----------

function moveJoint(portA, portB, nx, ny, objs) {
    const wireA = portA.owner;
    const wireB = portB.owner;
    const otherA = portA === wireA.inputPort ? wireA.outputPort : wireA.inputPort;
    const otherB = portB === wireB.inputPort ? wireB.outputPort : wireB.inputPort;

    let x = nx;
    let y = ny;

    let dx = x - otherA.x;
    let dy = y - otherA.y;
    let len = Math.hypot(dx, dy);
    if (len > MAX_WIRE_LENGTH) {
        const s = MAX_WIRE_LENGTH / len;
        x = otherA.x + dx * s;
        y = otherA.y + dy * s;
    }
    dx = x - otherB.x;
    dy = y - otherB.y;
    len = Math.hypot(dx, dy);
    if (len > MAX_WIRE_LENGTH) {
        const s = MAX_WIRE_LENGTH / len;
        x = otherB.x + dx * s;
        y = otherB.y + dy * s;
    }

    const attA = wireA.attachedObject(otherA);
    const hitA = raycastObjects(otherA.x, otherA.y, x, y, objs, attA);
    x = hitA.x;
    y = hitA.y;
    const attB = wireB.attachedObject(otherB);
    const hitB = raycastObjects(otherB.x, otherB.y, x, y, objs, attB);
    x = hitB.x;
    y = hitB.y;

    const r = PORT_RADIUS;
    x = Math.max(r, Math.min(x, canvas.width - r));
    y = Math.max(r, Math.min(y, canvas.height - r));

    portA.x = x;
    portA.y = y;
    portB.x = x;
    portB.y = y;
}

function snapJointOnRelease(portA, portB, objs) {
    const wireA = portA.owner;
    const otherA = portA === wireA.inputPort ? wireA.outputPort : wireA.inputPort;
    let dx = portA.x - otherA.x;
    let dy = portA.y - otherA.y;
    let len = Math.hypot(dx, dy);
    if (len < 1) len = 1;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = snapAngle(angle);
    const rad = angle * (Math.PI / 180);
    let nx = otherA.x + Math.cos(rad) * len;
    let ny = otherA.y + Math.sin(rad) * len;
    moveJoint(portA, portB, nx, ny, objs);
    const r = PORT_RADIUS;
    nx = snapGrid(portA.x - r, 2 * r, canvas.width) + r;
    ny = snapGrid(portA.y - r, 2 * r, canvas.height) + r;
    moveJoint(portA, portB, nx, ny, objs);
}

function translateWire(wire, dx, dy) {
    const r = PORT_RADIUS;
    let nx1 = wire.inputPort.x + dx;
    let ny1 = wire.inputPort.y + dy;
    let nx2 = wire.outputPort.x + dx;
    let ny2 = wire.outputPort.y + dy;

    const minX = Math.min(nx1, nx2) - r;
    const minY = Math.min(ny1, ny2) - r;
    const maxX = Math.max(nx1, nx2) + r;
    const maxY = Math.max(ny1, ny2) + r;
    let adjX = 0, adjY = 0;
    if (minX < 0) adjX = -minX;
    if (minY < 0) adjY = -minY;
    if (maxX > canvas.width) adjX = canvas.width - maxX;
    if (maxY > canvas.height) adjY = canvas.height - maxY;

    wire.inputPort.x = nx1 + adjX;
    wire.inputPort.y = ny1 + adjY;
    wire.outputPort.x = nx2 + adjX;
    wire.outputPort.y = ny2 + adjY;
}

// ---------- events ----------

canvas.addEventListener('mousedown', (e) => {
    const pos = getMousePos(e);
    shiftHeld = e.shiftKey;

    const port = findPortAt(pos.x, pos.y);
    if (port && port.owner.isWire) {
        if (port.isConnected && port.connectedTo.owner.isWire) {
            drag = { kind: 'joint', portA: port, portB: port.connectedTo };
            canvas.style.cursor = 'grabbing';
            return;
        }
        if (port.isConnected) port.disconnect();
        drag = { kind: 'port', port, wire: port.owner, startX: port.x, startY: port.y };
        canvas.style.cursor = 'grabbing';
        return;
    }

    const wireBody = findWireBodyAt(pos.x, pos.y);
    if (wireBody) {
        const connectedObjs = getObjectsConnectedToWire(wireBody);
        if (connectedObjs.length > 0) {
            const expanded = expandGroupForDirectLinks(connectedObjs);
            drag = {
                kind: 'wire-group',
                wire: wireBody,
                group: expanded,
                lastMouseX: pos.x,
                lastMouseY: pos.y,
                lastPositions: expanded.map(o => ({ obj: o, x: o.x, y: o.y }))
            };
        } else {
            drag = {
                kind: 'wire-translate',
                wire: wireBody,
                lastMouseX: pos.x,
                lastMouseY: pos.y
            };
        }
        canvas.style.cursor = 'grabbing';
        return;
    }

    const obj = findObjectAt(pos.x, pos.y);
    if (obj) {
        const startedOnPort = !!findObjectPortAt(pos.x, pos.y);
        const group = buildDragGroup(obj, e.shiftKey);
        drag = {
            kind: 'group',
            obj,
            group,
            offsetX: pos.x - obj.x,
            offsetY: pos.y - obj.y,
            lastPositions: group.map(o => ({ obj: o, x: o.x, y: o.y })),
            shiftActive: e.shiftKey,
            fromPort: startedOnPort
        };
        canvas.style.cursor = 'grabbing';
    }
});

window.addEventListener('mousemove', (e) => {
    const pos = getMousePos(e);
    mouse = pos;
    shiftHeld = e.shiftKey;

    const under = findObjectAt(pos.x, pos.y);
    hoveredLever = under instanceof Lever ? under : null;
    hoveredButton = under instanceof Button ? under : null;

    const hoverWirePort = findPortAt(pos.x, pos.y);
    const hoverObjPort = findObjectPortAt(pos.x, pos.y);
    if (hoverWirePort && hoverWirePort.isConnected) {
        hoveredJoint = hoverWirePort;
    } else if (hoverObjPort && hoverObjPort.isConnected) {
        hoveredJoint = hoverObjPort;
    } else {
        hoveredJoint = null;
    }

    if (!drag) {
        if (hoveredLever || hoveredButton || hoveredJoint) {
            canvas.style.cursor = 'pointer';
        } else if (findWireBodyAt(pos.x, pos.y)) {
            canvas.style.cursor = 'grab';
        } else if (findObjectAt(pos.x, pos.y)) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'default';
        }
        return;
    }

    if (drag.kind === 'group' && shiftHeld !== drag.shiftActive) {
        drag.shiftActive = shiftHeld;
        const newGroup = buildDragGroup(drag.obj, shiftHeld);
        drag.group = newGroup;
        drag.lastPositions = newGroup.map(o => ({ obj: o, x: o.x, y: o.y }));
        drag.offsetX = pos.x - drag.obj.x;
        drag.offsetY = pos.y - drag.obj.y;
    }

    if (drag.kind === 'group') {
        const targetX = pos.x - drag.offsetX;
        const targetY = pos.y - drag.offsetY;
        const dx = targetX - drag.obj.x;
        const dy = targetY - drag.obj.y;

        drag.lastPositions = applyGroupMove(drag.group, dx, dy, drag.lastPositions);

        let didConnect = false;
        for (const o of drag.group) {
            if (tryConnectObjectPorts(o, !!drag.fromPort)) didConnect = true;
        }
        if (didConnect && drag.fromPort) {
            drag.group = expandGroupForDirectLinks(drag.group);
            drag.lastPositions = drag.group.map(o => ({ obj: o, x: o.x, y: o.y }));
        }
        drag.offsetX = pos.x - drag.obj.x;
        drag.offsetY = pos.y - drag.obj.y;
    } else if (drag.kind === 'port') {
        drag.wire.movePort(drag.port, pos.x, pos.y, objects, canvas);
    } else if (drag.kind === 'joint') {
        moveJoint(drag.portA, drag.portB, pos.x, pos.y, objects);
    } else if (drag.kind === 'wire-translate') {
        const dx = pos.x - drag.lastMouseX;
        const dy = pos.y - drag.lastMouseY;
        translateWire(drag.wire, dx, dy);
        drag.lastMouseX = pos.x;
        drag.lastMouseY = pos.y;
    } else if (drag.kind === 'wire-group') {
        const dx = pos.x - drag.lastMouseX;
        const dy = pos.y - drag.lastMouseY;
        drag.lastPositions = applyGroupMove(drag.group, dx, dy, drag.lastPositions);
        drag.lastMouseX = pos.x;
        drag.lastMouseY = pos.y;
    }
});

window.addEventListener('mouseup', () => {
    if (!drag) return;

    if (drag.kind === 'group') {
        const primary = drag.obj;
        const snappedX = snapGrid(primary.x, primary.w, canvas.width);
        const snappedY = snapGrid(primary.y, primary.h, canvas.height);
        applyGroupMove(drag.group, snappedX - primary.x, snappedY - primary.y, drag.lastPositions);
        for (const o of drag.group) {
            tryConnectObjectPorts(o, !!drag.fromPort);
        }
        if (drag.fromPort) {
            drag.group = expandGroupForDirectLinks(drag.group);
            for (const o of drag.group) {
                for (const port of o.getPorts()) {
                    if (!port.connectedTo) continue;
                    if (!(port.connectedTo.owner instanceof Obj)) continue;
                    const ddx = port.connectedTo.x - port.x;
                    const ddy = port.connectedTo.y - port.y;
                    if (Math.hypot(ddx, ddy) > 0.5) {
                        o.x += ddx;
                        o.y += ddy;
                        o.x = clamp(o.x, o.w, canvas.width);
                        o.y = clamp(o.y, o.h, canvas.height);
                        o.updatePorts();
                    }
                }
            }
        }
        validateObjObjConnections();
    } else if (drag.kind === 'port') {
        drag.wire.snapPortOnRelease(drag.port, objects, canvas);
        tryConnect(drag.port, true);
    } else if (drag.kind === 'joint') {
        snapJointOnRelease(drag.portA, drag.portB, objects);
    } else if (drag.kind === 'wire-group') {
        if (drag.group.length > 0) {
            const primary = drag.group[0];
            applyGroupMove(
                drag.group,
                snapGrid(primary.x, primary.w, canvas.width) - primary.x,
                snapGrid(primary.y, primary.h, canvas.height) - primary.y,
                drag.lastPositions
            );
        }
        validateObjObjConnections();
    }

    drag = null;
    canvas.style.cursor = 'default';
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true;
    if (e.key === 'e' || e.key === 'E') {
        eHeld = true;
        if (hoveredLever) {
            hoveredLever.toggle();
        } else if (hoveredJoint && hoveredJoint.isConnected) {
            hoveredJoint.disconnect();
            hoveredJoint = null;
        }
    }

    if (e.key === 'Shift' && drag && drag.kind === 'group' && !drag.shiftActive) {
        drag.shiftActive = true;
        const newGroup = buildDragGroup(drag.obj, true);
        drag.group = newGroup;
        drag.lastPositions = newGroup.map(o => ({ obj: o, x: o.x, y: o.y }));
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        shiftHeld = false;
        if (drag && drag.kind === 'group' && drag.shiftActive) {
            drag.shiftActive = false;
            const newGroup = buildDragGroup(drag.obj, false);
            drag.group = newGroup;
            drag.lastPositions = newGroup.map(o => ({ obj: o, x: o.x, y: o.y }));
        }
    }
    if (e.key === 'e' || e.key === 'E') {
        eHeld = false;
    }
});

window.addEventListener('resize', resize);

// ---------- loop ----------

function drawTooltip(ctx, x, y, text) {
    ctx.font = '13px system-ui, sans-serif';
    const metrics = ctx.measureText(text);
    const padX = 8;
    const padY = 5;
    const tw = metrics.width + padX * 2;
    const th = 13 + padY * 2;
    const tx = x - tw / 2;
    const ty = y - th - 10;

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(tx + r, ty);
    ctx.arcTo(tx + tw, ty, tx + tw, ty + th, r);
    ctx.arcTo(tx + tw, ty + th, tx, ty + th, r);
    ctx.arcTo(tx, ty + th, tx, ty, r);
    ctx.arcTo(tx, ty, tx + tw, ty, r);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x - 5, ty + th);
    ctx.lineTo(x + 5, ty + th);
    ctx.lineTo(x, ty + th + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx + padX, ty + th / 2);
}

function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const o of objects) {
        if (o instanceof Button) {
            o.updateButton(now, hoveredButton === o, eHeld);
        }
        if (o instanceof Lever) {
            o.updateAnimation(dt);
        }
    }

    syncAllPorts();
    validateObjObjConnections();
    evaluateCircuit();

    for (const w of wires) w.draw(ctx);
    for (const o of objects) o.draw(ctx);

    if (!drag) {
        if (hoveredLever) {
            drawTooltip(ctx, hoveredLever.x + hoveredLever.w / 2, hoveredLever.y, 'E to toggle');
        } else if (hoveredButton) {
            drawTooltip(ctx, hoveredButton.x + hoveredButton.w / 2, hoveredButton.y, 'Hold E to press');
        } else if (hoveredJoint) {
            drawTooltip(ctx, hoveredJoint.x, hoveredJoint.y, 'E to disconnect');
        }
    }

    requestAnimationFrame(loop);
}

resize();
requestAnimationFrame(loop);
