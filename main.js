const GRID = 10;
const MAX_WIRE_LENGTH = 300;
const ANGLE_SNAP = 5;
const PORT_RADIUS = 8;
const WIRE_WIDTH = 5;
const BODY_FILL = 'rgb(65, 65, 80)';
const BUTTON_MIN_MS = 300;

function clamp(value, size, max) {
    return Math.max(0, Math.min(value, max - size));
}

function snapGrid(value, size, max) {
    const maxPos = max - size;
    const gridSnap = Math.round(value / GRID) * GRID;
    if (Math.abs(value - maxPos) <= Math.abs(value - gridSnap)) {
        return maxPos;
    }
    return clamp(gridSnap, size, max);
}

function snapAngle(deg) {
    return Math.round(deg / ANGLE_SNAP) * ANGLE_SNAP;
}

function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function circlesOverlap(x1, y1, r1, x2, y2, r2) {
    return dist(x1, y1, x2, y2) <= r1 + r2;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function segmentHitsRect(x1, y1, x2, y2, rx, ry, rw, rh, padding = 3) {
    const left = rx + padding;
    const right = rx + rw - padding;
    const top = ry + padding;
    const bottom = ry + rh - padding;
    if (right <= left || bottom <= top) return false;

    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;

    const clip = (p, q) => {
        if (Math.abs(p) < 1e-10) return q >= 0;
        const r = q / p;
        if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
        }
        return true;
    };

    if (!clip(-dx, x1 - left)) return false;
    if (!clip(dx, right - x1)) return false;
    if (!clip(-dy, y1 - top)) return false;
    if (!clip(dy, bottom - y1)) return false;
    return t0 < t1 && t1 > 0.01 && t0 < 0.99;
}

function pointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) {
        return { dist: dist(px, py, x1, y1), x: x1, y: y1, t: 0 };
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return { dist: dist(px, py, cx, cy), x: cx, y: cy, t };
}

function raycastRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let tMin = 0;
    let tMax = 1;

    const edges = [
        { p: -dx, q: x1 - rx },
        { p: dx, q: rx + rw - x1 },
        { p: -dy, q: y1 - ry },
        { p: dy, q: ry + rh - y1 }
    ];

    for (const { p, q } of edges) {
        if (Math.abs(p) < 1e-10) {
            if (q < 0) return null;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > tMax) return null;
            if (t > tMin) tMin = t;
        } else {
            if (t < tMin) return null;
            if (t < tMax) tMax = t;
        }
    }

    if (x1 > rx && x1 < rx + rw && y1 > ry && y1 < ry + rh) {
        return 0;
    }

    if (tMin > 0 && tMin <= 1) return tMin;
    return null;
}

function raycastObjects(x1, y1, x2, y2, objects, attachedObj = null, inset = 1.5) {
    let sx = x1;
    let sy = y1;

    if (attachedObj) {
        const cx = attachedObj.x + attachedObj.w / 2;
        const cy = attachedObj.y + attachedObj.h / 2;
        let odx = sx - cx;
        let ody = sy - cy;
        const od = Math.hypot(odx, ody) || 1;
        sx += (odx / od) * 3;
        sy += (ody / od) * 3;
    }

    let bestT = 1;
    let hit = false;

    for (const obj of objects) {
        const t = raycastRect(sx, sy, x2, y2, obj.x, obj.y, obj.w, obj.h);
        if (t !== null && t < bestT) {
            bestT = t;
            hit = true;
        }
    }

    if (!hit || bestT >= 1) {
        return { x: x2, y: y2 };
    }

    const segLen = Math.max(1, dist(sx, sy, x2, y2));
    const t = Math.max(0, bestT - inset / segLen);
    return {
        x: sx + (x2 - sx) * t,
        y: sy + (y2 - sy) * t
    };
}

function resolveOverlap(moving, other) {
    const overlapX = Math.min(moving.x + moving.w, other.x + other.w) - Math.max(moving.x, other.x);
    const overlapY = Math.min(moving.y + moving.h, other.y + other.h) - Math.max(moving.y, other.y);
    if (overlapX <= 0 || overlapY <= 0) return;

    if (overlapX < overlapY) {
        const movingCenter = moving.x + moving.w / 2;
        const otherCenter = other.x + other.w / 2;
        if (movingCenter < otherCenter) {
            moving.x = other.x - moving.w;
        } else {
            moving.x = other.x + other.w;
        }
    } else {
        const movingCenter = moving.y + moving.h / 2;
        const otherCenter = other.y + other.h / 2;
        if (movingCenter < otherCenter) {
            moving.y = other.y - moving.h;
        } else {
            moving.y = other.y + other.h;
        }
    }
}

function wireCrossesAnyObject(wire, objects) {
    const ax = wire.inputPort.x;
    const ay = wire.inputPort.y;
    const bx = wire.outputPort.x;
    const by = wire.outputPort.y;
    for (const obj of objects) {
        // padding 0 so the wire centerline cannot sit inside the body
        if (segmentHitsRect(ax, ay, bx, by, obj.x, obj.y, obj.w, obj.h, 0)) {
            return true;
        }
    }
    return false;
}

function anyWiresCross(wireList, objects) {
    for (const w of wireList) {
        if (wireCrossesAnyObject(w, objects)) return true;
    }
    return false;
}

function drawBody(ctx, x, y, w, h) {
    ctx.fillStyle = BODY_FILL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawLabel(ctx, x, y, w, h, text) {
    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
}

class Port {
    constructor(x, y, type, owner) {
        this.x = x;
        this.y = y;
        this.type = type; // 'input' | 'output'
        this.owner = owner;
        this.connectedTo = null;
        this.radius = PORT_RADIUS;
        this.powered = false;
    }

    get isConnected() {
        return this.connectedTo !== null;
    }

    get color() {
        if (this.powered) return '#3b82f6';
        if (this.isConnected) return '#111';
        return this.type === 'input' ? '#22c55e' : '#ef4444';
    }

    contains(px, py) {
        return dist(px, py, this.x, this.y) <= this.radius + 2;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        // powered = solid blue, no outline
        if (!this.powered) {
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    connect(other, canvas) {
        if (this.connectedTo || other.connectedTo) return false;
        if (this.type === other.type) return false;

        const thisIsWire = !!this.owner.isWire;
        const otherIsWire = !!other.owner.isWire;

        this.connectedTo = other;
        other.connectedTo = this;

        if (thisIsWire && !otherIsWire) {
            this.x = other.x;
            this.y = other.y;
        } else if (otherIsWire && !thisIsWire) {
            other.x = this.x;
            other.y = this.y;
        } else if (thisIsWire && otherIsWire) {
            const mx = (this.x + other.x) / 2;
            const my = (this.y + other.y) / 2;
            this.x = mx;
            this.y = my;
            other.x = mx;
            other.y = my;
        } else {
            // object ↔ object: only connect if already touching; nudge to exact align
            const d0 = dist(this.x, this.y, other.x, other.y);
            if (d0 > PORT_RADIUS * 2 + 8) {
                this.connectedTo = null;
                other.connectedTo = null;
                return false;
            }
            const obj = this.owner;
            obj.x += other.x - this.x;
            obj.y += other.y - this.y;
            obj.x = clamp(obj.x, obj.w, canvas.width);
            obj.y = clamp(obj.y, obj.h, canvas.height);
            obj.updatePorts();
            if (dist(this.x, this.y, other.x, other.y) > 0.5) {
                obj.x += other.x - this.x;
                obj.y += other.y - this.y;
                obj.x = clamp(obj.x, obj.w, canvas.width);
                obj.y = clamp(obj.y, obj.h, canvas.height);
                obj.updatePorts();
            }
            if (dist(this.x, this.y, other.x, other.y) > PORT_RADIUS * 2) {
                this.connectedTo = null;
                other.connectedTo = null;
                return false;
            }
        }
        return true;
    }

    disconnect() {
        if (!this.connectedTo) return;
        const other = this.connectedTo;
        this.connectedTo = null;
        other.connectedTo = null;
    }
}

// ---------- Obj (passthrough block) ----------

class Obj {
    constructor(x, y, w = 80, h = 60) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.inputPort = new Port(0, 0, 'input', this);
        this.outputPort = new Port(0, 0, 'output', this);
        this.updatePorts();
    }

    updatePorts() {
        if (this.inputPort) {
            this.inputPort.x = this.x + this.w / 2;
            this.inputPort.y = this.y;
            if (this.inputPort.connectedTo && this.inputPort.connectedTo.owner.isWire) {
                this.inputPort.connectedTo.x = this.inputPort.x;
                this.inputPort.connectedTo.y = this.inputPort.y;
            }
        }
        if (this.outputPort) {
            this.outputPort.x = this.x + this.w / 2;
            this.outputPort.y = this.y + this.h;
            if (this.outputPort.connectedTo && this.outputPort.connectedTo.owner.isWire) {
                this.outputPort.connectedTo.x = this.outputPort.x;
                this.outputPort.connectedTo.y = this.outputPort.y;
            }
        }
    }

    /** true if this input port has a live signal (unconnected = false) */
    inputSignal(port) {
        if (!port) return false;
        return !!port.powered;
    }

    /**
     * Evaluate this component's outputs from current input powered flags.
     * Always assigns the correct boolean (true or false) so inverting gates work.
     */
    evaluate() {
        if (this.inputPort && this.outputPort) {
            this.outputPort.powered = this.inputSignal(this.inputPort);
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
    }

    contains(px, py) {
        return px >= this.x && px <= this.x + this.w &&
               py >= this.y && py <= this.y + this.h;
    }

    getPorts() {
        const ports = [];
        if (this.inputs) ports.push(...this.inputs);
        if (this.outputs) ports.push(...this.outputs);
        if (this.inputPort) ports.push(this.inputPort);
        if (this.inputA) ports.push(this.inputA);
        if (this.inputB) ports.push(this.inputB);
        if (this.inputC) ports.push(this.inputC);
        if (this.outputPort) ports.push(this.outputPort);
        if (this.outputSum) ports.push(this.outputSum);
        if (this.outputCarry) ports.push(this.outputCarry);
        return ports;
    }

    get isSource() {
        return false;
    }
}

// ---------- Dual-input gate base ----------

class Gate2 extends Obj {
    constructor(x, y, label, op) {
        super(x, y, 90, 56);
        this.inputPort = null; // use inputA / inputB
        this.inputA = new Port(0, 0, 'input', this);
        this.inputB = new Port(0, 0, 'input', this);
        this.label = label;
        this.op = op; // (a, b) => boolean
        this.updatePorts();
    }

    updatePorts() {
        if (this.inputA) {
            this.inputA.x = this.x + this.w * 0.3;
            this.inputA.y = this.y;
            if (this.inputA.connectedTo && this.inputA.connectedTo.owner.isWire) {
                this.inputA.connectedTo.x = this.inputA.x;
                this.inputA.connectedTo.y = this.inputA.y;
            }
        }
        if (this.inputB) {
            this.inputB.x = this.x + this.w * 0.7;
            this.inputB.y = this.y;
            if (this.inputB.connectedTo && this.inputB.connectedTo.owner.isWire) {
                this.inputB.connectedTo.x = this.inputB.x;
                this.inputB.connectedTo.y = this.inputB.y;
            }
        }
        if (this.outputPort) {
            this.outputPort.x = this.x + this.w / 2;
            this.outputPort.y = this.y + this.h;
            if (this.outputPort.connectedTo && this.outputPort.connectedTo.owner.isWire) {
                this.outputPort.connectedTo.x = this.outputPort.x;
                this.outputPort.connectedTo.y = this.outputPort.y;
            }
        }
    }

    evaluate() {
        const a = this.inputSignal(this.inputA);
        const b = this.inputSignal(this.inputB);
        if (this.outputPort) {
            this.outputPort.powered = this.op(a, b);
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h, this.label);
    }
}

class AND extends Gate2 {
    constructor(x, y) { super(x, y, 'AND', (a, b) => a && b); }
}
class OR extends Gate2 {
    constructor(x, y) { super(x, y, 'OR', (a, b) => a || b); }
}
class XOR extends Gate2 {
    constructor(x, y) { super(x, y, 'XOR', (a, b) => a !== b); }
}
class NAND extends Gate2 {
    constructor(x, y) { super(x, y, 'NAND', (a, b) => !(a && b)); }
}
class NOR extends Gate2 {
    constructor(x, y) { super(x, y, 'NOR', (a, b) => !(a || b)); }
}
class XNOR extends Gate2 {
    constructor(x, y) { super(x, y, 'XNOR', (a, b) => a === b); }
}

// ---------- NOT ----------

class NOT extends Obj {
    constructor(x, y) {
        super(x, y, 70, 50);
        this.updatePorts();
    }

    evaluate() {
        const a = this.inputSignal(this.inputPort);
        if (this.outputPort) {
            this.outputPort.powered = !a;
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h, 'NOT');
    }
}

// ---------- Lever ----------

class Lever extends Obj {
    constructor(x, y, w = 70, h = 50) {
        super(x, y, w, h);
        this.inputPort = null;
        this.on = false;
        this.switchT = 0;
        this.updatePorts();
    }

    get isSource() { return true; }

    toggle() {
        this.on = !this.on;
    }

    updateAnimation(dt) {
        const target = this.on ? 1 : 0;
        const speed = 10;
        if (this.switchT < target) {
            this.switchT = Math.min(target, this.switchT + speed * dt);
        } else if (this.switchT > target) {
            this.switchT = Math.max(target, this.switchT - speed * dt);
        }
    }

    evaluate() {
        if (this.outputPort) {
            this.outputPort.powered = !!this.on;
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);

        const trackW = this.w * 0.55;
        const trackH = this.h * 0.36;
        const trackX = this.x + (this.w - trackW) / 2;
        const trackY = this.y + (this.h - trackH) / 2 - 2;

        const t = this.switchT;
        const r = Math.round(60 + t * (34 - 60));
        const g = Math.round(60 + t * (197 - 60));
        const b = Math.round(60 + t * (94 - 60));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        const radius = trackH / 2;
        ctx.moveTo(trackX + radius, trackY);
        ctx.arcTo(trackX + trackW, trackY, trackX + trackW, trackY + trackH, radius);
        ctx.arcTo(trackX + trackW, trackY + trackH, trackX, trackY + trackH, radius);
        ctx.arcTo(trackX, trackY + trackH, trackX, trackY, radius);
        ctx.arcTo(trackX, trackY, trackX + trackW, trackY, radius);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        const knobR = trackH / 2 - 2;
        const knobX = trackX + radius + t * (trackW - 2 * radius);
        const knobY = trackY + trackH / 2;
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobR, 0, Math.PI * 2);
        ctx.fillStyle = '#f5f5f5';
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.stroke();
    }
}

// ---------- Battery (always on) ----------

class Battery extends Obj {
    constructor(x, y) {
        super(x, y, 60, 48);
        this.inputPort = null;
        this.updatePorts();
    }

    get isSource() { return true; }

    evaluate() {
        if (this.outputPort) this.outputPort.powered = true;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2 - 2;
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy);
        ctx.lineTo(cx - 4, cy);
        ctx.moveTo(cx + 4, cy);
        ctx.lineTo(cx + 12, cy);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 8);
        ctx.lineTo(cx - 4, cy + 8);
        ctx.moveTo(cx + 4, cy - 5);
        ctx.lineTo(cx + 4, cy + 5);
        ctx.stroke();
    }
}

// ---------- Button ----------

class Button extends Obj {
    constructor(x, y) {
        super(x, y, 70, 50);
        this.inputPort = null;
        this.active = false;
        this.pressStart = 0;
        this.activeUntil = 0;
        this.updatePorts();
    }

    get isSource() { return true; }

    updateButton(now, hovering, eHeld) {
        if (hovering && eHeld) {
            if (!this.active) {
                this.pressStart = now;
            }
            this.active = true;
            this.activeUntil = 0;
        } else if (this.active && this.activeUntil === 0) {
            const elapsed = now - this.pressStart;
            if (elapsed < BUTTON_MIN_MS) {
                this.activeUntil = this.pressStart + BUTTON_MIN_MS;
            } else {
                this.active = false;
            }
        }

        if (this.activeUntil && now >= this.activeUntil) {
            this.active = false;
            this.activeUntil = 0;
        }
    }

    evaluate() {
        if (this.outputPort) {
            this.outputPort.powered = !!this.active;
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2 - 2;
        const r = 12;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = this.active ? '#ef4444' : '#991b1b';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

// ---------- Lamp (input only) ----------

class Lamp extends Obj {
    constructor(x, y) {
        super(x, y, 56, 64);
        this.outputPort = null;
        this.updatePorts();
    }

    updatePorts() {
        if (this.inputPort) {
            this.inputPort.x = this.x + this.w / 2;
            this.inputPort.y = this.y;
            if (this.inputPort.connectedTo && this.inputPort.connectedTo.owner.isWire) {
                this.inputPort.connectedTo.x = this.inputPort.x;
                this.inputPort.connectedTo.y = this.inputPort.y;
            }
        }
    }

    evaluate() {
        // no output
    }

    get lit() {
        return this.inputSignal(this.inputPort);
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y + this.h * 0.55, this.w, this.h * 0.45);

        const cx = this.x + this.w / 2;
        const by = this.y + this.h * 0.38;
        const br = this.w * 0.32;

        if (this.lit) {
            const grd = ctx.createRadialGradient(cx, by, 2, cx, by, br * 2.2);
            grd.addColorStop(0, 'rgba(255, 220, 100, 0.85)');
            grd.addColorStop(0.5, 'rgba(255, 200, 60, 0.35)');
            grd.addColorStop(1, 'rgba(255, 180, 40, 0)');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(cx, by, br * 2.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(cx, by, br, 0, Math.PI * 2);
            ctx.fillStyle = '#fde68a';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(cx, by, br, 0, Math.PI * 2);
            ctx.fillStyle = BODY_FILL;
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 6, by + 4);
            ctx.lineTo(cx - 2, by - 4);
            ctx.lineTo(cx + 2, by + 4);
            ctx.lineTo(cx + 6, by - 4);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        const neckY = this.y + this.h * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx - 8, by + br - 2);
        ctx.lineTo(cx - 8, neckY);
        ctx.moveTo(cx + 8, by + br - 2);
        ctx.lineTo(cx + 8, neckY);
        ctx.stroke();
    }
}


// ---------- Goal (input-only, order-sensitive) ----------

class Goal extends Obj {
    constructor(x, y, pattern) {
        const n = pattern.length;
        const w = Math.max(70, 24 * n + 36);
        super(x, y, w, 64);
        this.inputPort = null;
        this.outputPort = null;
        this.pattern = pattern.map(Boolean);
        this.inputs = [];
        for (let i = 0; i < n; i++) {
            this.inputs.push(new Port(0, 0, 'input', this));
        }
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputs) return;
        const n = this.inputs.length;
        for (let i = 0; i < n; i++) {
            const p = this.inputs[i];
            p.x = this.x + (this.w * (i + 1)) / (n + 1);
            p.y = this.y;
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {}

    /** true when every input is connected and matches the required pattern */
    isSatisfied() {
        if (!this.inputs || !this.pattern) return false;
        for (let i = 0; i < this.inputs.length; i++) {
            const p = this.inputs[i];
            if (!p.isConnected) return false;
            if (!!p.powered !== !!this.pattern[i]) return false;
        }
        return true;
    }

    setPattern(pattern) {
        this.pattern = pattern.map(Boolean);
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.55, 'GOAL');
        // required pattern hints along bottom
        const n = this.pattern.length;
        for (let i = 0; i < n; i++) {
            const cx = this.x + (this.w * (i + 1)) / (n + 1);
            const cy = this.y + this.h * 0.72;
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fillStyle = this.pattern[i] ? '#3b82f6' : '#333';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}

// ---------- Half Adder: Sum = A⊕B, Carry = A∧B ----------

class HalfAdder extends Obj {
    constructor(x, y) {
        super(x, y, 100, 60);
        this.inputPort = null;
        this.outputPort = null;
        this.inputA = new Port(0, 0, 'input', this);
        this.inputB = new Port(0, 0, 'input', this);
        this.outputSum = new Port(0, 0, 'output', this);
        this.outputCarry = new Port(0, 0, 'output', this);
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputA) return;
        this.inputA.x = this.x + this.w * 0.3;
        this.inputA.y = this.y;
        this.inputB.x = this.x + this.w * 0.7;
        this.inputB.y = this.y;
        this.outputSum.x = this.x + this.w * 0.3;
        this.outputSum.y = this.y + this.h;
        this.outputCarry.x = this.x + this.w * 0.7;
        this.outputCarry.y = this.y + this.h;
        for (const p of [this.inputA, this.inputB, this.outputSum, this.outputCarry]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {
        const a = this.inputSignal(this.inputA);
        const b = this.inputSignal(this.inputB);
        this.outputSum.powered = a !== b;
        this.outputCarry.powered = a && b;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.42, '½ ADD');
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // above bottom ports
        ctx.fillText('Sum', this.x + this.w * 0.3, this.y + this.h * 0.62);
        ctx.fillText('Carry', this.x + this.w * 0.7, this.y + this.h * 0.62);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- Full Adder: Sum = A⊕B⊕Cin, Cout = majority ----------

class FullAdder extends Obj {
    constructor(x, y) {
        super(x, y, 110, 64);
        this.inputPort = null;
        this.outputPort = null;
        this.inputA = new Port(0, 0, 'input', this);
        this.inputB = new Port(0, 0, 'input', this);
        this.inputC = new Port(0, 0, 'input', this);
        this.outputSum = new Port(0, 0, 'output', this);
        this.outputCarry = new Port(0, 0, 'output', this);
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputA) return;
        this.inputA.x = this.x + this.w * 0.25;
        this.inputA.y = this.y;
        this.inputB.x = this.x + this.w * 0.5;
        this.inputB.y = this.y;
        this.inputC.x = this.x + this.w * 0.75;
        this.inputC.y = this.y;
        this.outputSum.x = this.x + this.w * 0.35;
        this.outputSum.y = this.y + this.h;
        this.outputCarry.x = this.x + this.w * 0.65;
        this.outputCarry.y = this.y + this.h;
        for (const p of [this.inputA, this.inputB, this.inputC, this.outputSum, this.outputCarry]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {
        const a = this.inputSignal(this.inputA);
        const b = this.inputSignal(this.inputB);
        const c = this.inputSignal(this.inputC);
        const axorb = a !== b;
        this.outputSum.powered = axorb !== c;
        this.outputCarry.powered = (a && b) || (c && axorb);
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.42, 'FULL ADD');
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Sum', this.x + this.w * 0.35, this.y + this.h * 0.62);
        ctx.fillText('Carry', this.x + this.w * 0.65, this.y + this.h * 0.62);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- N-bit number source (MSB left → LSB right) ----------

class BitNumber extends Obj {
    constructor(x, y, bits, value = 0, label = null) {
        const w = Math.max(80, bits * 22 + 28);
        super(x, y, w, 58);
        this.inputPort = null;
        this.outputPort = null;
        this.bitCount = bits;
        this.value = value & ((1 << bits) - 1);
        this.label = label || (bits + '-bit');
        this.outputs = [];
        for (let i = 0; i < bits; i++) {
            this.outputs.push(new Port(0, 0, 'output', this));
        }
        this.updatePorts();
    }

    get isSource() { return true; }

    setValue(v) {
        this.value = v & ((1 << this.bitCount) - 1);
    }

    updatePorts() {
        if (!this.outputs) return;
        const n = this.bitCount;
        for (let i = 0; i < n; i++) {
            const p = this.outputs[i];
            p.x = this.x + (this.w * (i + 1)) / (n + 1);
            p.y = this.y + this.h;
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {
        // MSB at index 0 (left)
        for (let i = 0; i < this.bitCount; i++) {
            const shift = this.bitCount - 1 - i;
            this.outputs[i].powered = ((this.value >> shift) & 1) === 1;
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        const text = this.label + ': ' + this.value;
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.55, text);
        // bit dots
        for (let i = 0; i < this.bitCount; i++) {
            const shift = this.bitCount - 1 - i;
            const on = ((this.value >> shift) & 1) === 1;
            const cx = this.x + (this.w * (i + 1)) / (this.bitCount + 1);
            const cy = this.y + this.h * 0.72;
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fillStyle = on ? '#3b82f6' : '#333';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
}


class Wire {
    constructor(x1, y1, x2, y2) {
        this.inputPort = new Port(x1, y1, 'input', this);
        this.outputPort = new Port(x2, y2, 'output', this);
        this.isWire = true;
    }

    get length() {
        return dist(
            this.inputPort.x, this.inputPort.y,
            this.outputPort.x, this.outputPort.y
        );
    }

    get powered() {
        return this.inputPort.powered || this.outputPort.powered;
    }

    attachedObject(port) {
        if (port.connectedTo && port.connectedTo.owner instanceof Obj) {
            return port.connectedTo.owner;
        }
        return null;
    }

    hitBody(px, py, threshold = 8) {
        const info = pointToSegment(
            px, py,
            this.inputPort.x, this.inputPort.y,
            this.outputPort.x, this.outputPort.y
        );
        if (this.inputPort.contains(px, py) || this.outputPort.contains(px, py)) {
            return false;
        }
        return info.dist <= threshold;
    }

    constrainPortPosition(port, nx, ny, objects, canvas) {
        const other = port === this.inputPort ? this.outputPort : this.inputPort;

        let dx = nx - other.x;
        let dy = ny - other.y;
        let len = Math.hypot(dx, dy);
        if (len > MAX_WIRE_LENGTH) {
            const s = MAX_WIRE_LENGTH / len;
            nx = other.x + dx * s;
            ny = other.y + dy * s;
        }

        const attached = this.attachedObject(other);
        const hit = raycastObjects(other.x, other.y, nx, ny, objects, attached);
        nx = hit.x;
        ny = hit.y;

        const r = port.radius;
        nx = Math.max(r, Math.min(nx, canvas.width - r));
        ny = Math.max(r, Math.min(ny, canvas.height - r));
        return { x: nx, y: ny };
    }

    movePort(port, nx, ny, objects, canvas) {
        const p = this.constrainPortPosition(port, nx, ny, objects, canvas);
        port.x = p.x;
        port.y = p.y;
    }

    snapPortOnRelease(port, objects, canvas) {
        const other = port === this.inputPort ? this.outputPort : this.inputPort;
        let dx = port.x - other.x;
        let dy = port.y - other.y;
        let len = Math.hypot(dx, dy);
        if (len < 1) len = 1;

        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        angle = snapAngle(angle);
        const rad = angle * (Math.PI / 180);

        let nx = other.x + Math.cos(rad) * len;
        let ny = other.y + Math.sin(rad) * len;

        const p = this.constrainPortPosition(port, nx, ny, objects, canvas);
        const r = port.radius;
        nx = snapGrid(p.x - r, 2 * r, canvas.width) + r;
        ny = snapGrid(p.y - r, 2 * r, canvas.height) + r;
        const p2 = this.constrainPortPosition(port, nx, ny, objects, canvas);
        port.x = p2.x;
        port.y = p2.y;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.moveTo(this.inputPort.x, this.inputPort.y);
        ctx.lineTo(this.outputPort.x, this.outputPort.y);
        ctx.strokeStyle = this.powered ? '#3b82f6' : '#333';
        ctx.lineWidth = WIRE_WIDTH;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    getPorts() {
        return [this.inputPort, this.outputPort];
    }
}

// ---------- app state ----------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let objects = [];
let wires = [];
let drag = null;
let mouse = { x: 0, y: 0 };
let hoveredLever = null;
let hoveredButton = null;
let hoveredJoint = null;
let lastTime = performance.now();
let shiftHeld = false;
let eHeld = false;

// Level / goal state
let currentLevel = 0;
let levelGoal = null;          // Goal instance
let levelBitNums = [];         // BitNumber instances to update on multi-case
let levelCases = null;         // [{goal, values: {id: n}}, ...] or null
let caseIndex = 0;
let satisfiedHold = 0;         // seconds goal has been continuously satisfied
let levelWon = false;
let onSelectScreen = true;
const SATISFY_TIME = 0.35;

function bitsFromValue(value, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(((value >> i) & 1) === 1);
    return out;
}

function valueFromBits(bits) {
    let v = 0;
    for (let i = 0; i < bits.length; i++) {
        v = (v << 1) | (bits[i] ? 1 : 0);
    }
    return v;
}

function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
}

function makeAddCases(bitWidth, count) {
    const maxSum = (1 << bitWidth) - 1;
    const cases = [];
    const seen = new Set();
    let guard = 0;
    while (cases.length < count && guard++ < 200) {
        const a = randInt(0, maxSum);
        const b = randInt(0, maxSum - a);
        const key = a + ',' + b;
        if (seen.has(key)) continue;
        seen.add(key);
        cases.push({
            a, b,
            goal: bitsFromValue(a + b, bitWidth),
            values: { A: a, B: b }
        });
    }
    return cases;
}

/** Level definitions. build() mutates objects/wires arrays and returns { goal, bitNums? }. */
const LEVELS = [
    {
        name: 'Power On',
        desc: 'Connect the battery to the goal so it receives ON.',
        build() {
            objects.push(new Battery(80, 120));
            wires.push(new Wire(220, 200, 360, 200));
            const goal = new Goal(420, 280, [true]);
            objects.push(goal);
            return { goal };
        }
    },
    {
        name: 'Both On',
        desc: 'Get ON into both goal inputs. You have batteries, an AND, and an OR — not everything is required.',
        build() {
            objects.push(new Battery(60, 80));
            objects.push(new Battery(160, 80));
            objects.push(new AND(60, 200));
            objects.push(new OR(180, 200));
            wires.push(new Wire(300, 120, 400, 120));
            wires.push(new Wire(300, 180, 400, 180));
            const goal = new Goal(480, 280, [true, true]);
            objects.push(goal);
            return { goal };
        }
    },
    {
        name: 'Invert',
        desc: 'The goal wants OFF, and its input must be connected. Use the NOT gate.',
        build() {
            objects.push(new Battery(80, 100));
            objects.push(new NOT(220, 100));
            objects.push(new AND(80, 220)); // decoy
            wires.push(new Wire(340, 140, 440, 140));
            wires.push(new Wire(340, 220, 440, 220));
            const goal = new Goal(500, 280, [false]);
            objects.push(goal);
            return { goal };
        }
    },
    {
        name: 'Exactly One',
        desc: 'Feed the goal ON using XOR. Two batteries are available — only one path should be live at the goal.',
        build() {
            objects.push(new Battery(60, 80));
            objects.push(new Battery(160, 80));
            objects.push(new XOR(100, 200));
            objects.push(new OR(220, 200)); // decoy
            wires.push(new Wire(320, 140, 420, 140));
            wires.push(new Wire(320, 200, 420, 200));
            const goal = new Goal(500, 300, [true]);
            objects.push(goal);
            return { goal };
        }
    },
    {
        name: 'Half Adder',
        desc: 'Wire the half adder so the goal receives Sum=ON and Carry=OFF (1+0). A is powered, B is not.',
        build() {
            objects.push(new Battery(60, 80)); // A source
            // no second battery → B left unconnected = 0
            objects.push(new HalfAdder(200, 160));
            objects.push(new XOR(60, 260)); // decoy
            objects.push(new AND(160, 260)); // decoy
            wires.push(new Wire(360, 120, 460, 120));
            wires.push(new Wire(360, 180, 460, 180));
            wires.push(new Wire(360, 240, 460, 240));
            const goal = new Goal(520, 300, [true, false]); // S, C
            objects.push(goal);
            return { goal };
        }
    },
    {
        name: 'Full Adder',
        desc: 'Make Sum=OFF and Carry=ON for inputs that need a carry (e.g. 1+1+0 or 1+0+1).',
        build() {
            objects.push(new Battery(40, 60));
            objects.push(new Battery(120, 60));
            objects.push(new Battery(200, 60));
            objects.push(new FullAdder(120, 160));
            objects.push(new HalfAdder(40, 260)); // decoy / alternate
            wires.push(new Wire(280, 100, 380, 100));
            wires.push(new Wire(280, 160, 380, 160));
            wires.push(new Wire(280, 220, 380, 220));
            wires.push(new Wire(280, 280, 380, 280));
            const goal = new Goal(480, 300, [false, true]); // S=0 C=1
            objects.push(goal);
            return { goal };
        }
    },
    {
        name: 'Read the Bits',
        desc: 'The 4-bit number outputs its value as four signals (MSB left). Match the goal to that number.',
        build() {
            const num = new BitNumber(80, 100, 4, 9, 'A'); // 1001
            objects.push(num);
            objects.push(new NOT(80, 220)); // decoy
            wires.push(new Wire(220, 160, 300, 160));
            wires.push(new Wire(220, 200, 300, 200));
            wires.push(new Wire(220, 240, 300, 240));
            wires.push(new Wire(220, 280, 300, 280));
            const goal = new Goal(400, 300, bitsFromValue(9, 4));
            objects.push(goal);
            return { goal, bitNums: [num] };
        }
    },
    {
        name: '4-bit Add',
        desc: 'Add A + B (sum ≤ 15). Goal needs the 4-bit sum. Pass 5 different test cases.',
        multiCase: true,
        build() {
            const cases = makeAddCases(4, 5);
            const A = new BitNumber(40, 80, 4, cases[0].a, 'A');
            const B = new BitNumber(40, 180, 4, cases[0].b, 'B');
            objects.push(A, B);
            // provide full adders for a 4-bit ripple
            objects.push(new FullAdder(280, 60));
            objects.push(new FullAdder(280, 140));
            objects.push(new FullAdder(280, 220));
            objects.push(new FullAdder(280, 300));
            objects.push(new HalfAdder(400, 60)); // extra
            for (let i = 0; i < 22; i++) {
                const col = i % 4;
                const row = Math.floor(i / 4);
                wires.push(new Wire(
                    500 + col * 18, 70 + row * 36,
                    560 + col * 18, 70 + row * 36
                ));
            }
            const goal = new Goal(640, 200, cases[0].goal);
            objects.push(goal);
            return { goal, bitNums: [A, B], cases };
        }
    },
    {
        name: 'Ripple Practice',
        desc: 'Another 4-bit addition — fewer spare parts. Five test cases, sum ≤ 15.',
        multiCase: true,
        build() {
            const cases = makeAddCases(4, 5);
            const A = new BitNumber(30, 70, 4, cases[0].a, 'A');
            const B = new BitNumber(30, 170, 4, cases[0].b, 'B');
            objects.push(A, B);
            objects.push(new FullAdder(250, 50));
            objects.push(new FullAdder(250, 130));
            objects.push(new FullAdder(250, 210));
            objects.push(new FullAdder(250, 290));
            for (let i = 0; i < 20; i++) {
                const col = i % 4;
                const row = Math.floor(i / 4);
                wires.push(new Wire(
                    400 + col * 16, 50 + row * 38,
                    460 + col * 16, 50 + row * 38
                ));
            }
            const goal = new Goal(560, 180, cases[0].goal);
            objects.push(goal);
            return { goal, bitNums: [A, B], cases };
        }
    },
    {
        name: '8-bit Challenge',
        desc: 'Add two 4-bit numbers into an 8-bit goal (high nibble is 0000 since sum ≤ 15). Five cases.',
        multiCase: true,
        build() {
            const cases = makeAddCases(4, 5).map(c => ({
                ...c,
                goal: bitsFromValue(c.a + c.b, 8) // 8-bit with leading zeros
            }));
            const A = new BitNumber(30, 80, 4, cases[0].a, 'A');
            const B = new BitNumber(30, 180, 4, cases[0].b, 'B');
            objects.push(A, B);
            for (let i = 0; i < 4; i++) objects.push(new FullAdder(240, 40 + i * 80));
            objects.push(new HalfAdder(370, 40));
            objects.push(new OR(370, 140));
            objects.push(new AND(370, 220));
            for (let i = 0; i < 24; i++) {
                const col = i % 4;
                const row = Math.floor(i / 4);
                wires.push(new Wire(
                    460 + col * 16, 40 + row * 36,
                    520 + col * 16, 40 + row * 36
                ));
            }
            const goal = new Goal(600, 160, cases[0].goal);
            objects.push(goal);
            return { goal, bitNums: [A, B], cases };
        }
    }
];

function updateGoalUI() {
    const title = document.getElementById('level-title');
    const desc = document.getElementById('level-desc');
    const patternEl = document.getElementById('goal-pattern');
    const caseEl = document.getElementById('goal-case');
    const lvl = LEVELS[currentLevel];
    title.textContent = 'Level ' + (currentLevel + 1) + ' — ' + lvl.name;
    desc.textContent = lvl.desc;
    patternEl.innerHTML = '';
    if (levelGoal) {
        levelGoal.pattern.forEach((on, i) => {
            const d = document.createElement('div');
            d.className = 'bit ' + (on ? 'on' : 'off');
            d.textContent = on ? '1' : '0';
            if (levelGoal.inputs[i] && levelGoal.inputs[i].isConnected &&
                !!levelGoal.inputs[i].powered === !!on) {
                d.classList.add('ok');
            }
            patternEl.appendChild(d);
        });
    }
    if (levelCases) {
        caseEl.textContent = 'Test case ' + (caseIndex + 1) + ' / ' + levelCases.length;
        if (levelBitNums.length >= 2) {
            caseEl.textContent += '  ·  A=' + levelBitNums[0].value + '  B=' + levelBitNums[1].value;
        }
    } else {
        caseEl.textContent = '';
    }
}

function applyCase(idx) {
    if (!levelCases || !levelCases[idx]) return;
    const c = levelCases[idx];
    caseIndex = idx;
    if (levelGoal) levelGoal.setPattern(c.goal);
    if (c.values) {
        if (c.values.A != null && levelBitNums[0]) levelBitNums[0].setValue(c.values.A);
        if (c.values.B != null && levelBitNums[1]) levelBitNums[1].setValue(c.values.B);
    }
    satisfiedHold = 0;
    updateGoalUI();
}

function setPlayUI(playing) {
    onSelectScreen = !playing;
    document.getElementById('level-select').hidden = playing;
    document.getElementById('hud').hidden = !playing;
    document.getElementById('hint').hidden = !playing;
}

function buildLevelSelect() {
    const grid = document.getElementById('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach((lvl, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-card';
        btn.innerHTML =
            '<div class="num">Level ' + (i + 1) + '</div>' +
            '<div class="name">' + lvl.name + '</div>' +
            '<div class="blurb">' + lvl.desc + '</div>';
        btn.addEventListener('click', () => loadLevel(i));
        grid.appendChild(btn);
    });
}

function showLevelSelect() {
    objects = [];
    wires = [];
    drag = null;
    levelGoal = null;
    levelBitNums = [];
    levelCases = null;
    caseIndex = 0;
    satisfiedHold = 0;
    levelWon = false;
    document.getElementById('win-overlay').classList.remove('show');
    setPlayUI(false);
    buildLevelSelect();
}

function loadLevel(index) {
    currentLevel = Math.max(0, Math.min(index, LEVELS.length - 1));
    objects = [];
    wires = [];
    drag = null;
    levelGoal = null;
    levelBitNums = [];
    levelCases = null;
    caseIndex = 0;
    satisfiedHold = 0;
    levelWon = false;
    document.getElementById('win-overlay').classList.remove('show');
    setPlayUI(true);

    const meta = LEVELS[currentLevel].build();
    levelGoal = meta.goal;
    levelBitNums = meta.bitNums || [];
    if (meta.cases) {
        levelCases = meta.cases;
        applyCase(0);
    } else {
        updateGoalUI();
    }
}

function showWin() {
    levelWon = true;
    const overlay = document.getElementById('win-overlay');
    const title = document.getElementById('win-title');
    const msg = document.getElementById('win-msg');
    const btnNext = document.getElementById('btn-next');
    if (currentLevel >= LEVELS.length - 1) {
        title.textContent = 'You Win!';
        msg.textContent = 'All 10 levels cleared.';
        btnNext.textContent = 'Play Again';
    } else {
        title.textContent = 'Level Complete!';
        msg.textContent = LEVELS[currentLevel].name + ' cleared.';
        btnNext.textContent = 'Next Level';
    }
    overlay.classList.add('show');
}

function checkGoal(dt) {
    if (onSelectScreen || levelWon || !levelGoal) return;
    if (levelGoal.isSatisfied()) {
        satisfiedHold += dt;
        if (satisfiedHold >= SATISFY_TIME) {
            if (levelCases && caseIndex < levelCases.length - 1) {
                applyCase(caseIndex + 1);
            } else {
                showWin();
            }
        }
    } else {
        satisfiedHold = 0;
    }
    updateGoalUI();
}

document.getElementById('btn-next').addEventListener('click', () => {
    if (currentLevel >= LEVELS.length - 1) showLevelSelect();
    else loadLevel(currentLevel + 1);
});
document.getElementById('btn-replay').addEventListener('click', () => {
    loadLevel(currentLevel);
});
document.getElementById('btn-win-levels').addEventListener('click', () => {
    showLevelSelect();
});
document.getElementById('btn-levels').addEventListener('click', () => {
    showLevelSelect();
});

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

function tryConnect(port, extraRadius = 4) {
    if (port.isConnected) return false;
    let best = null;
    let bestDist = Infinity;
    for (const other of allPorts()) {
        if (other === port) continue;
        if (other.owner === port.owner) continue;
        if (other.isConnected) continue;
        if (port.type === other.type) continue;
        const d = dist(port.x, port.y, other.x, other.y);
        const limit = port.radius + other.radius + extraRadius;
        if (d <= limit && d < bestDist) {
            bestDist = d;
            best = other;
        }
    }
    if (!best) return false;
    return port.connect(best, canvas);
}

/** After a drag ends: connect every free port that is touching a compatible free port. */
function connectOverlappingPorts() {
    // Prefer wire→object first so wire ends snap onto component ports
    const free = allPorts().filter(p => !p.isConnected);
    free.sort((a, b) => {
        const aw = a.owner.isWire ? 0 : 1;
        const bw = b.owner.isWire ? 0 : 1;
        return aw - bw;
    });
    for (const port of free) {
        if (port.isConnected) continue;
        tryConnect(port, 6);
    }
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
        const desired = new Map();
        for (const o of objects) {
            const outs = o.getPorts().filter(p => p.type === 'output');
            const befores = outs.map(p => p.powered);
            o.evaluate();
            outs.forEach((p, i) => {
                desired.set(p, !!p.powered);
                p.powered = befores[i];
            });
        }

        clearPower();
        for (const [port, val] of desired) {
            port.powered = val;
        }
        propagateWiresAndLinks();

        let stable = true;
        for (const o of objects) {
            const outs = o.getPorts().filter(p => p.type === 'output');
            const befores = outs.map(p => p.powered);
            o.evaluate();
            for (let i = 0; i < outs.length; i++) {
                const got = !!outs[i].powered;
                const expected = desired.get(outs[i]);
                outs[i].powered = befores[i];
                if (got !== expected) stable = false;
            }
        }
        if (stable) break;
        propagateWiresAndLinks();
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

function applyWireTranslation(wire, dx, dy) {
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

/** Translate a free wire without phasing through objects (stepped to avoid tunneling). */
function translateWire(wire, dx, dy, objs) {
    const distMove = Math.hypot(dx, dy);
    if (distMove < 1e-6) return;
    const steps = Math.max(1, Math.ceil(distMove / 3));
    const sdx = dx / steps;
    const sdy = dy / steps;
    for (let i = 0; i < steps; i++) {
        const ox1 = wire.inputPort.x;
        const oy1 = wire.inputPort.y;
        const ox2 = wire.outputPort.x;
        const oy2 = wire.outputPort.y;
        applyWireTranslation(wire, sdx, sdy);
        if (wireCrossesAnyObject(wire, objs)) {
            wire.inputPort.x = ox1;
            wire.inputPort.y = oy1;
            wire.outputPort.x = ox2;
            wire.outputPort.y = oy2;
            break;
        }
    }
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
        const group = buildDragGroup(obj, e.shiftKey);
        drag = {
            kind: 'group',
            obj,
            group,
            offsetX: pos.x - obj.x,
            offsetY: pos.y - obj.y,
            lastPositions: group.map(o => ({ obj: o, x: o.x, y: o.y })),
            shiftActive: e.shiftKey
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
        drag.offsetX = pos.x - drag.obj.x;
        drag.offsetY = pos.y - drag.obj.y;
    } else if (drag.kind === 'port') {
        drag.wire.movePort(drag.port, pos.x, pos.y, objects, canvas);
    } else if (drag.kind === 'joint') {
        moveJoint(drag.portA, drag.portB, pos.x, pos.y, objects);
    } else if (drag.kind === 'wire-translate') {
        const dx = pos.x - drag.lastMouseX;
        const dy = pos.y - drag.lastMouseY;
        translateWire(drag.wire, dx, dy, objects);
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
        // Align already-linked object↔object ports within the group
        const gset = new Set(drag.group);
        for (const o of drag.group) {
            for (const port of o.getPorts()) {
                if (!port.connectedTo) continue;
                if (!(port.connectedTo.owner instanceof Obj)) continue;
                const other = port.connectedTo.owner;
                if (!gset.has(other)) continue;
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
    } else if (drag.kind === 'port') {
        drag.wire.snapPortOnRelease(drag.port, objects, canvas);
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
    } else if (drag.kind === 'wire-translate') {
        const w = drag.wire;
        w.snapPortOnRelease(w.inputPort, objects, canvas);
        w.snapPortOnRelease(w.outputPort, objects, canvas);
        if (wireCrossesAnyObject(w, objects)) {
            const p1 = w.constrainPortPosition(w.inputPort, w.inputPort.x, w.inputPort.y, objects, canvas);
            w.inputPort.x = p1.x; w.inputPort.y = p1.y;
            const p2 = w.constrainPortPosition(w.outputPort, w.outputPort.x, w.outputPort.y, objects, canvas);
            w.outputPort.x = p2.x; w.outputPort.y = p2.y;
        }
    }

    syncAllPorts();
    connectOverlappingPorts();
    validateObjObjConnections();

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

function endDrag() {
    if (!drag) return;
    // synthesize mouseup path
    const ev = new Event('mouseup');
    window.dispatchEvent(ev);
}

window.addEventListener('blur', endDrag);
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
    checkGoal(dt);

    for (const w of wires) w.draw(ctx);
    for (const o of objects) o.draw(ctx);
    for (const p of allPorts()) p.draw(ctx);

    if (!drag && !levelWon) {
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
showLevelSelect();
requestAnimationFrame(loop);
