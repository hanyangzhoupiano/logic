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
        if (obj.noCollision) continue;
        if (obj instanceof Door && obj.open) continue;
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

function rotatePoint(px, py, cx, cy, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = px - cx, dy = py - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function snapAngle15(deg) {
    return Math.round(deg / 15) * 15;
}

function orientObjectPorts(obj) {
    if (!obj || !obj.angle) return;
    const cx = obj.x + obj.w / 2;
    const cy = obj.y + obj.h / 2;
    for (const p of obj.getPorts()) {
        const r = rotatePoint(p.x, p.y, cx, cy, obj.angle);
        p.x = r.x;
        p.y = r.y;
        if (p.connectedTo && p.connectedTo.owner && p.connectedTo.owner.isWire) {
            p.connectedTo.x = p.x;
            p.connectedTo.y = p.y;
        }
    }
}

function drawHealthBar(ctx, x, y, w, hp, maxHp) {
    if (hp >= maxHp) return;
    const bh = 5;
    const by = y - 10;
    ctx.fillStyle = '#222';
    ctx.fillRect(x, by, w, bh);
    ctx.fillStyle = hp / maxHp > 0.35 ? '#22c55e' : '#ef4444';
    ctx.fillRect(x, by, w * Math.max(0, hp / maxHp), bh);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, by + 0.5, w - 1, bh - 1);
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
        this.angle = 0; // degrees, snapped to 15 on release
        this.inputPort = new Port(0, 0, 'input', this);
        this.outputPort = new Port(0, 0, 'output', this);
        this.updatePorts();
    }

    rotateBy(deltaDeg) {
        this.angle = (this.angle + deltaDeg) % 360;
        if (this.angle < 0) this.angle += 360;
        this.updatePorts();
        orientObjectPorts(this);
    }

    snapRotation() {
        this.angle = snapAngle15(this.angle) % 360;
        if (this.angle < 0) this.angle += 360;
        this.updatePorts();
        orientObjectPorts(this);
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
        if (!this.angle) {
            return px >= this.x && px <= this.x + this.w &&
                   py >= this.y && py <= this.y + this.h;
        }
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2;
        const inv = rotatePoint(px, py, cx, cy, -this.angle);
        return inv.x >= this.x && inv.x <= this.x + this.w &&
               inv.y >= this.y && inv.y <= this.y + this.h;
    }

    getPorts() {
        const ports = [];
        if (this.inputs) ports.push(...this.inputs);
        if (this.outputs) ports.push(...this.outputs);
        if (this.inputPort) ports.push(this.inputPort);
        if (this.inputA) ports.push(this.inputA);
        if (this.inputB) ports.push(this.inputB);
        if (this.inputC) ports.push(this.inputC);
        if (this.inputD) ports.push(this.inputD);
        if (this.inputT) ports.push(this.inputT);
        if (this.clkPort) ports.push(this.clkPort);
        if (this.selPort) ports.push(this.selPort);
        if (this.enPort) ports.push(this.enPort);
        if (this.rstPort) ports.push(this.rstPort);
        if (this.shootPort) ports.push(this.shootPort);
        if (this.reloadPort) ports.push(this.reloadPort);
        if (this.healPort) ports.push(this.healPort);
        if (this.outputA) ports.push(this.outputA);
        if (this.outputB) ports.push(this.outputB);
        if (this.outputPort) ports.push(this.outputPort);
        if (this.outputSum) ports.push(this.outputSum);
        if (this.outputCarry) ports.push(this.outputCarry);
        if (this.outputQ) ports.push(this.outputQ);
        if (this.outputQn) ports.push(this.outputQn);
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
    /**
     * @param {number} bits bit width
     * @param {number} value initial value
     * @param {{signed?: boolean, label?: string}} [opts]
     */
    constructor(x, y, bits, value = 0, opts = {}) {
        const signed = !!opts.signed;
        const w = Math.max(90, bits * 20 + 36);
        super(x, y, w, 62);
        this.inputPort = null;
        this.outputPort = null;
        this.bitCount = bits;
        this.signed = signed;
        this.label = opts.label || (signed ? bits + '-bit±' : bits + '-bit');
        this.outputs = [];
        for (let i = 0; i < bits; i++) {
            this.outputs.push(new Port(0, 0, 'output', this));
        }
        this.setValue(value);
        this.updatePorts();
    }

    get isSource() { return true; }

    get minValue() {
        return this.signed ? -(1 << (this.bitCount - 1)) : 0;
    }

    get maxValue() {
        return this.signed
            ? (1 << (this.bitCount - 1)) - 1
            : (1 << this.bitCount) - 1;
    }

    /** Raw bit pattern as unsigned integer (two's complement if signed). */
    get bitPattern() {
        if (!this.signed || this.value >= 0) {
            return this.value & ((1 << this.bitCount) - 1);
        }
        return ((1 << this.bitCount) + this.value) & ((1 << this.bitCount) - 1);
    }

    setValue(v) {
        v = Math.round(Number(v));
        if (!Number.isFinite(v)) v = 0;
        this.value = Math.max(this.minValue, Math.min(this.maxValue, v));
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
        const pat = this.bitPattern;
        for (let i = 0; i < this.bitCount; i++) {
            const shift = this.bitCount - 1 - i; // MSB left
            this.outputs[i].powered = ((pat >> shift) & 1) === 1;
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        const text = this.label + ': ' + this.value;
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.42, text);
        const pat = this.bitPattern;
        for (let i = 0; i < this.bitCount; i++) {
            const shift = this.bitCount - 1 - i;
            const on = ((pat >> shift) & 1) === 1;
            const cx = this.x + (this.w * (i + 1)) / (this.bitCount + 1);
            const cy = this.y + this.h * 0.68;
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



// ---------- Clock (free-running square wave) ----------

class Clock extends Obj {
    constructor(x, y, periodMs = 900) {
        super(x, y, 72, 56);
        this.inputPort = null;
        this.periodMs = periodMs;
        this.phase = 0;
        this.on = false;
        this.updatePorts();
    }

    get isSource() { return true; }
    get isSequential() { return true; }

    sequentialTick(dt) {
        this.phase += dt * 1000;
        while (this.phase >= this.periodMs) {
            this.phase -= this.periodMs;
            this.on = !this.on;
        }
    }

    evaluate() {
        this.outputPort.powered = this.on;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.45, 'CLK');
        // square-wave glyph
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h * 0.72;
        ctx.strokeStyle = this.on ? '#3b82f6' : '#666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy + 4);
        ctx.lineTo(cx - 8, cy + 4);
        ctx.lineTo(cx - 8, cy - 6);
        ctx.lineTo(cx + 2, cy - 6);
        ctx.lineTo(cx + 2, cy + 4);
        ctx.lineTo(cx + 12, cy + 4);
        ctx.lineTo(cx + 12, cy - 6);
        ctx.lineTo(cx + 18, cy - 6);
        ctx.stroke();
    }
}

// ---------- D Flip-Flop (rising-edge) ----------

class DFlipFlop extends Obj {
    constructor(x, y) {
        super(x, y, 88, 64);
        this.inputPort = null;
        this.outputPort = null;
        this.inputD = new Port(0, 0, 'input', this);
        this.clkPort = new Port(0, 0, 'input', this);
        this.outputQ = new Port(0, 0, 'output', this);
        this.outputQn = new Port(0, 0, 'output', this);
        this.q = false;
        this.prevClk = false;
        this.updatePorts();
    }

    get isSequential() { return true; }

    updatePorts() {
        if (!this.inputD) return;
        this.inputD.x = this.x + this.w * 0.3;
        this.inputD.y = this.y;
        this.clkPort.x = this.x + this.w * 0.7;
        this.clkPort.y = this.y;
        this.outputQ.x = this.x + this.w * 0.3;
        this.outputQ.y = this.y + this.h;
        this.outputQn.x = this.x + this.w * 0.7;
        this.outputQn.y = this.y + this.h;
        for (const p of [this.inputD, this.clkPort, this.outputQ, this.outputQn]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    sequentialTick() {
        const clk = this.inputSignal(this.clkPort);
        const d = this.inputSignal(this.inputD);
        if (clk && !this.prevClk) this.q = d;
        this.prevClk = clk;
    }

    evaluate() {
        this.outputQ.powered = this.q;
        this.outputQn.powered = !this.q;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.42, 'D FF');
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('D', this.x + this.w * 0.3, this.y + this.h * 0.28);
        ctx.fillText('>', this.x + this.w * 0.7, this.y + this.h * 0.28);
        ctx.fillText('Q', this.x + this.w * 0.3, this.y + this.h * 0.62);
        ctx.fillText('Q̄', this.x + this.w * 0.7, this.y + this.h * 0.62);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- T Flip-Flop (toggle on rising edge when T=1) ----------

class TFlipFlop extends Obj {
    constructor(x, y) {
        super(x, y, 88, 64);
        this.inputPort = null;
        this.outputPort = null;
        this.inputT = new Port(0, 0, 'input', this);
        this.clkPort = new Port(0, 0, 'input', this);
        this.outputQ = new Port(0, 0, 'output', this);
        this.outputQn = new Port(0, 0, 'output', this);
        this.q = false;
        this.prevClk = false;
        this.updatePorts();
    }

    get isSequential() { return true; }

    updatePorts() {
        if (!this.inputT) return;
        this.inputT.x = this.x + this.w * 0.3;
        this.inputT.y = this.y;
        this.clkPort.x = this.x + this.w * 0.7;
        this.clkPort.y = this.y;
        this.outputQ.x = this.x + this.w * 0.3;
        this.outputQ.y = this.y + this.h;
        this.outputQn.x = this.x + this.w * 0.7;
        this.outputQn.y = this.y + this.h;
        for (const p of [this.inputT, this.clkPort, this.outputQ, this.outputQn]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    sequentialTick() {
        const clk = this.inputSignal(this.clkPort);
        const t = this.inputSignal(this.inputT);
        if (clk && !this.prevClk && t) this.q = !this.q;
        this.prevClk = clk;
    }

    evaluate() {
        this.outputQ.powered = this.q;
        this.outputQn.powered = !this.q;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.42, 'T FF');
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('T', this.x + this.w * 0.3, this.y + this.h * 0.28);
        ctx.fillText('>', this.x + this.w * 0.7, this.y + this.h * 0.28);
        ctx.fillText('Q', this.x + this.w * 0.3, this.y + this.h * 0.62);
        ctx.fillText('Q̄', this.x + this.w * 0.7, this.y + this.h * 0.62);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- 2:1 Multiplexer ----------

class Mux2 extends Obj {
    constructor(x, y) {
        super(x, y, 96, 64);
        this.inputPort = null;
        this.outputPort = null;
        this.inputA = new Port(0, 0, 'input', this);
        this.inputB = new Port(0, 0, 'input', this);
        this.selPort = new Port(0, 0, 'input', this);
        this.outputPort = new Port(0, 0, 'output', this);
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputA) return;
        this.inputA.x = this.x + this.w * 0.25;
        this.inputA.y = this.y;
        this.inputB.x = this.x + this.w * 0.5;
        this.inputB.y = this.y;
        this.selPort.x = this.x + this.w * 0.75;
        this.selPort.y = this.y;
        this.outputPort.x = this.x + this.w / 2;
        this.outputPort.y = this.y + this.h;
        for (const p of [this.inputA, this.inputB, this.selPort, this.outputPort]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {
        const sel = this.inputSignal(this.selPort);
        this.outputPort.powered = sel
            ? this.inputSignal(this.inputB)
            : this.inputSignal(this.inputA);
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.42, 'MUX');
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('0', this.x + this.w * 0.25, this.y + this.h * 0.28);
        ctx.fillText('1', this.x + this.w * 0.5, this.y + this.h * 0.28);
        ctx.fillText('S', this.x + this.w * 0.75, this.y + this.h * 0.28);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- 2-to-4 Decoder ----------

class Decoder2 extends Obj {
    constructor(x, y) {
        super(x, y, 110, 70);
        this.inputPort = null;
        this.outputPort = null;
        this.inputA = new Port(0, 0, 'input', this); // bit0 LSB
        this.inputB = new Port(0, 0, 'input', this); // bit1 MSB
        this.outputs = [];
        for (let i = 0; i < 4; i++) this.outputs.push(new Port(0, 0, 'output', this));
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputA) return;
        this.inputA.x = this.x + this.w * 0.35;
        this.inputA.y = this.y;
        this.inputB.x = this.x + this.w * 0.65;
        this.inputB.y = this.y;
        for (let i = 0; i < 4; i++) {
            const p = this.outputs[i];
            p.x = this.x + (this.w * (i + 1)) / 5;
            p.y = this.y + this.h;
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
        for (const p of [this.inputA, this.inputB]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {
        const a = this.inputSignal(this.inputA) ? 1 : 0;
        const b = this.inputSignal(this.inputB) ? 1 : 0;
        const idx = a + (b << 1);
        for (let i = 0; i < 4; i++) this.outputs[i].powered = i === idx;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.4, 'DEC 2→4');
        ctx.fillStyle = '#aaa';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A0', this.x + this.w * 0.35, this.y + this.h * 0.28);
        ctx.fillText('A1', this.x + this.w * 0.65, this.y + this.h * 0.28);
        for (let i = 0; i < 4; i++) {
            ctx.fillText(String(i), this.x + (this.w * (i + 1)) / 5, this.y + this.h * 0.62);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- 1-bit equality comparator ----------

class Comparator extends Obj {
    constructor(x, y) {
        super(x, y, 90, 56);
        this.inputPort = null;
        this.inputA = new Port(0, 0, 'input', this);
        this.inputB = new Port(0, 0, 'input', this);
        this.outputPort = new Port(0, 0, 'output', this);
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputA) return;
        this.inputA.x = this.x + this.w * 0.3;
        this.inputA.y = this.y;
        this.inputB.x = this.x + this.w * 0.7;
        this.inputB.y = this.y;
        this.outputPort.x = this.x + this.w / 2;
        this.outputPort.y = this.y + this.h;
        for (const p of [this.inputA, this.inputB, this.outputPort]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    evaluate() {
        this.outputPort.powered =
            this.inputSignal(this.inputA) === this.inputSignal(this.inputB);
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.55, 'A = B');
    }
}

// ---------- 4-bit Register (load on rising CLK when EN high or EN open) ----------

class Register4 extends Obj {
    constructor(x, y) {
        const w = Math.max(100, 4 * 22 + 36);
        super(x, y, w, 72);
        this.inputPort = null;
        this.outputPort = null;
        this.inputs = [];
        this.outputs = [];
        for (let i = 0; i < 4; i++) {
            this.inputs.push(new Port(0, 0, 'input', this));
            this.outputs.push(new Port(0, 0, 'output', this));
        }
        this.clkPort = new Port(0, 0, 'input', this);
        this.enPort = new Port(0, 0, 'input', this);
        this.bits = [false, false, false, false];
        this.prevClk = false;
        this.updatePorts();
    }

    get isSequential() { return true; }

    updatePorts() {
        if (!this.inputs) return;
        for (let i = 0; i < 4; i++) {
            const ix = this.x + (this.w * (i + 1)) / 6;
            this.inputs[i].x = ix;
            this.inputs[i].y = this.y;
            this.outputs[i].x = ix;
            this.outputs[i].y = this.y + this.h;
            for (const p of [this.inputs[i], this.outputs[i]]) {
                if (p.connectedTo && p.connectedTo.owner.isWire) {
                    p.connectedTo.x = p.x;
                    p.connectedTo.y = p.y;
                }
            }
        }
        this.clkPort.x = this.x + this.w * 0.85;
        this.clkPort.y = this.y;
        this.enPort.x = this.x + this.w * 0.95;
        this.enPort.y = this.y + this.h * 0.35;
        for (const p of [this.clkPort, this.enPort]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    sequentialTick() {
        const clk = this.inputSignal(this.clkPort);
        // EN open (unconnected) counts as enabled
        const en = !this.enPort.isConnected || this.inputSignal(this.enPort);
        if (clk && !this.prevClk && en) {
            for (let i = 0; i < 4; i++) this.bits[i] = this.inputSignal(this.inputs[i]);
        }
        this.prevClk = clk;
    }

    evaluate() {
        for (let i = 0; i < 4; i++) this.outputs[i].powered = this.bits[i];
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.4, 'REG4');
        ctx.fillStyle = '#aaa';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CLK', this.x + this.w * 0.85, this.y + this.h * 0.28);
        ctx.fillText('EN', this.x + this.w * 0.95, this.y + this.h * 0.55);
        for (let i = 0; i < 4; i++) {
            const cx = this.x + (this.w * (i + 1)) / 6;
            ctx.beginPath();
            ctx.arc(cx, this.y + this.h * 0.58, 4, 0, Math.PI * 2);
            ctx.fillStyle = this.bits[i] ? '#3b82f6' : '#333';
            ctx.fill();
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- 4-bit binary counter (rising CLK, optional RST) ----------

class Counter4 extends Obj {
    constructor(x, y) {
        const w = Math.max(100, 4 * 22 + 40);
        super(x, y, w, 68);
        this.inputPort = null;
        this.outputPort = null;
        this.clkPort = new Port(0, 0, 'input', this);
        this.rstPort = new Port(0, 0, 'input', this);
        this.outputs = [];
        for (let i = 0; i < 4; i++) this.outputs.push(new Port(0, 0, 'output', this));
        this.value = 0;
        this.prevClk = false;
        this.updatePorts();
    }

    get isSequential() { return true; }

    updatePorts() {
        if (!this.outputs) return;
        this.clkPort.x = this.x + this.w * 0.3;
        this.clkPort.y = this.y;
        this.rstPort.x = this.x + this.w * 0.7;
        this.rstPort.y = this.y;
        for (const p of [this.clkPort, this.rstPort]) {
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
        for (let i = 0; i < 4; i++) {
            const p = this.outputs[i];
            p.x = this.x + (this.w * (i + 1)) / 5;
            p.y = this.y + this.h;
            if (p.connectedTo && p.connectedTo.owner.isWire) {
                p.connectedTo.x = p.x;
                p.connectedTo.y = p.y;
            }
        }
    }

    sequentialTick() {
        if (this.inputSignal(this.rstPort)) {
            this.value = 0;
            this.prevClk = this.inputSignal(this.clkPort);
            return;
        }
        const clk = this.inputSignal(this.clkPort);
        if (clk && !this.prevClk) this.value = (this.value + 1) & 0xf;
        this.prevClk = clk;
    }

    evaluate() {
        for (let i = 0; i < 4; i++) {
            const shift = 3 - i; // MSB left
            this.outputs[i].powered = ((this.value >> shift) & 1) === 1;
        }
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.38, 'CNT ' + this.value);
        ctx.fillStyle = '#aaa';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CLK', this.x + this.w * 0.3, this.y + this.h * 0.28);
        ctx.fillText('RST', this.x + this.w * 0.7, this.y + this.h * 0.28);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

// ---------- Pulse: one-shot high for ~0.25s on rising edge of input ----------

class Pulse extends Obj {
    constructor(x, y) {
        super(x, y, 80, 56);
        this.timer = 0;
        this.prevIn = false;
        this.updatePorts();
    }

    get isSequential() { return true; }

    sequentialTick(dt) {
        const inn = this.inputSignal(this.inputPort);
        if (inn && !this.prevIn) this.timer = 0.28;
        this.prevIn = inn;
        if (this.timer > 0) this.timer = Math.max(0, this.timer - dt);
    }

    evaluate() {
        this.outputPort.powered = this.timer > 0;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.55, 'PULSE');
    }
}



// ---------- Physics / world objects ----------

/** Movable solid block — no ports; drag or push with pistons. */
class Crate extends Obj {
    constructor(x, y, w = 48, h = 48) {
        super(x, y, w, h);
        this.inputPort = null;
        this.outputPort = null;
        this.isPushable = true;
        this.hp = 40;
        this.maxHp = 40;
        this.lastDamageAt = -999;
    }

    getPorts() { return []; }
    evaluate() {}

    takeDamage(amount) {
        if (amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        this.lastDamageAt = performance.now() / 1000;
        spawnFloatText(this.x + this.w / 2, this.y, '-' + Math.round(amount), '#60a5fa');
        spawnHitSpark(this.x + this.w / 2, this.y + this.h / 2, '#93c5fd');
        if (this.hp <= 0) {
            const i = objects.indexOf(this);
            if (i >= 0) objects.splice(i, 1);
        }
    }

    physicsTick(dt) {
        const now = performance.now() / 1000;
        if (this.hp < this.maxHp && now - this.lastDamageAt >= 20) {
            this.hp = this.maxHp;
        }
    }

    draw(ctx) {
        ctx.fillStyle = '#8B6914';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#3d2e0a';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
        ctx.strokeStyle = '#5c4510';
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
            const yy = this.y + (this.h * i) / 3;
            ctx.beginPath();
            ctx.moveTo(this.x + 3, yy);
            ctx.lineTo(this.x + this.w - 3, yy);
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(this.x + this.w / 2, this.y + 3);
        ctx.lineTo(this.x + this.w / 2, this.y + this.h - 3);
        ctx.stroke();
        drawHealthBar(ctx, this.x, this.y, this.w, this.hp, this.maxHp);
    }
}

/**
 * Pressure plate — no body collision (objects pass through / sit on top).
 * Outputs ON when any solid object overlaps it. Wires do not count.
 */
class PressurePlate extends Obj {
    constructor(x, y) {
        super(x, y, 72, 18);
        this.inputPort = null;
        this.noCollision = true;
        this.pressed = false;   // physical contact this frame
        this.active = false;    // output signal
        this.pressAge = 0;      // how long current press has been held
        this.remain = 0;        // extra time to stay ON after short press
        this.minMs = 0.3;       // minimum ON duration (same idea as button)
        this.updatePorts();
    }

    get isSource() { return true; }

    updatePorts() {
        if (this.outputPort) {
            this.outputPort.x = this.x + this.w / 2;
            this.outputPort.y = this.y + this.h;
            if (this.outputPort.connectedTo && this.outputPort.connectedTo.owner.isWire) {
                this.outputPort.connectedTo.x = this.outputPort.x;
                this.outputPort.connectedTo.y = this.outputPort.y;
            }
        }
    }

    physicsTick(dt) {
        this.pressed = false;
        for (const o of objects) {
            if (o === this) continue;
            if (o.noCollision) continue;
            if (o instanceof Glue) continue;
            if (rectsOverlap(this.x, this.y, this.w, this.h, o.x, o.y, o.w, o.h)) {
                this.pressed = true;
                break;
            }
        }
        if (!this.pressed) {
            for (const a of arrows) {
                if (rectsOverlap(this.x, this.y, this.w, this.h, a.x - 2, a.y - 2, 4, 4)) {
                    this.pressed = true;
                    break;
                }
            }
        }
        if (!this.pressed) {
            for (const e of enemies) {
                if (e.dead) continue;
                if (rectsOverlap(this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) {
                    this.pressed = true;
                    break;
                }
            }
        }

        // Mirror button: any contact turns ON immediately; signal lasts ≥300ms total
        if (this.pressed) {
            if (!this.active) this.pressAge = 0;
            this.active = true;
            this.remain = 0;
            this.pressAge += dt;
        } else if (this.active) {
            if (this.remain > 0) {
                this.remain -= dt;
                if (this.remain <= 0) {
                    this.active = false;
                    this.remain = 0;
                }
            } else if (this.pressAge < this.minMs) {
                // just released after a short press — stretch to min duration
                this.remain = this.minMs - this.pressAge;
                this.pressAge = this.minMs;
            } else {
                this.active = false;
            }
        } else {
            this.pressAge = 0;
            this.remain = 0;
        }
    }

    evaluate() {
        this.outputPort.powered = this.active;
    }

    draw(ctx) {
        const y = this.y + (this.pressed ? 3 : 0);
        const h = this.h - (this.pressed ? 3 : 0);
        ctx.fillStyle = this.pressed ? '#666' : '#888';
        ctx.fillRect(this.x, y, this.w, h);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, y + 0.5, this.w - 1, h - 1);
        ctx.fillStyle = '#ccc';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PLATE', this.x + this.w / 2, y + h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

/** Shared piston logic: dir = 'right'|'left'|'up'|'down' */
class PistonBase extends Obj {
    constructor(x, y, sticky = false, dir = 'right') {
        super(x, y, 44, 44);
        this.inputPort = null;
        this.outputPort = null;
        this.inputPort = new Port(0, 0, 'input', this);
        this.sticky = sticky;
        this.dir = dir;
        this.extension = 0;       // 0..maxExt
        this.maxExt = 40;
        this.stuckObj = null;     // sticky only
        this.updatePorts();
    }

    updatePorts() {
        if (!this.inputPort) return;
        // input on the back face
        if (this.dir === 'right') {
            this.inputPort.x = this.x;
            this.inputPort.y = this.y + this.h / 2;
        } else if (this.dir === 'left') {
            this.inputPort.x = this.x + this.w;
            this.inputPort.y = this.y + this.h / 2;
        } else if (this.dir === 'down') {
            this.inputPort.x = this.x + this.w / 2;
            this.inputPort.y = this.y;
        } else {
            this.inputPort.x = this.x + this.w / 2;
            this.inputPort.y = this.y + this.h;
        }
        if (this.inputPort.connectedTo && this.inputPort.connectedTo.owner.isWire) {
            this.inputPort.connectedTo.x = this.inputPort.x;
            this.inputPort.connectedTo.y = this.inputPort.y;
        }
    }

    headRect() {
        const e = this.extension;
        if (this.dir === 'right') return { x: this.x + this.w, y: this.y + 4, w: e, h: this.h - 8 };
        if (this.dir === 'left') return { x: this.x - e, y: this.y + 4, w: e, h: this.h - 8 };
        if (this.dir === 'down') return { x: this.x + 4, y: this.y + this.h, w: this.w - 8, h: e };
        return { x: this.x + 4, y: this.y - e, w: this.w - 8, h: e };
    }

    /** Solid volume including extended head (for door-like blocking). */
    solidRects() {
        const rects = [{ x: this.x, y: this.y, w: this.w, h: this.h }];
        if (this.extension > 1) rects.push(this.headRect());
        return rects;
    }

    evaluate() {}

    physicsTick(dt) {
        const powered = this.inputSignal(this.inputPort);
        const target = powered ? this.maxExt : 0;
        const speed = 120; // px/s
        const prev = this.extension;
        if (this.extension < target) {
            this.extension = Math.min(target, this.extension + speed * dt);
        } else if (this.extension > target) {
            this.extension = Math.max(target, this.extension - speed * dt);
        }
        const delta = this.extension - prev;
        if (Math.abs(delta) < 0.01) {
            if (!powered) this.stuckObj = null;
            return;
        }

        if (delta > 0) {
            // extending — push
            this.pushAlong(delta);
        } else {
            // retracting
            if (this.sticky && this.stuckObj) {
                this.pullStuck(delta);
            }
        }
        if (!powered && this.extension < 1) this.stuckObj = null;
    }

    axis() {
        if (this.dir === 'right') return { ax: 1, ay: 0 };
        if (this.dir === 'left') return { ax: -1, ay: 0 };
        if (this.dir === 'down') return { ax: 0, ay: 1 };
        return { ax: 0, ay: -1 };
    }

    pushAlong(delta) {
        const head = this.headRect();
        const { ax, ay } = this.axis();
        // find objects overlapping head
        const hits = [];
        for (const o of objects) {
            if (o === this) continue;
            if (o.noCollision) continue;
            if (o instanceof Glue) continue;
            if (o instanceof Door && o.open) continue;
            if (rectsOverlap(head.x, head.y, head.w, head.h, o.x, o.y, o.w, o.h)) {
                hits.push(o);
            }
        }
        if (hits.length === 0) {
            this.stuckObj = null;
            return;
        }
        // push whole physical groups
        const moved = new Set();
        for (const h of hits) {
            const group = getPhysicalGroup(h);
            for (const o of group) {
                if (moved.has(o)) continue;
                moved.add(o);
                o.x += ax * delta;
                o.y += ay * delta;
                o.x = clamp(o.x, o.w, canvas.width);
                o.y = clamp(o.y, o.h, canvas.height);
                if (o.updatePorts) o.updatePorts();
            }
            if (this.sticky) this.stuckObj = h;
        }
        // resolve overlaps after push
        for (const o of moved) {
            for (const other of objects) {
                if (moved.has(other) || other === this) continue;
                if (other.noCollision) continue;
                if (other instanceof Door && other.open) continue;
                if (rectsOverlap(o.x, o.y, o.w, o.h, other.x, other.y, other.w, other.h)) {
                    resolveOverlap(o, other);
                    o.x = clamp(o.x, o.w, canvas.width);
                    o.y = clamp(o.y, o.h, canvas.height);
                    if (o.updatePorts) o.updatePorts();
                }
            }
        }
    }

    pullStuck(delta) {
        // delta is negative
        if (!this.stuckObj || !objects.includes(this.stuckObj)) {
            this.stuckObj = null;
            return;
        }
        const { ax, ay } = this.axis();
        const group = getPhysicalGroup(this.stuckObj);
        for (const o of group) {
            o.x += ax * delta;
            o.y += ay * delta;
            o.x = clamp(o.x, o.w, canvas.width);
            o.y = clamp(o.y, o.h, canvas.height);
            if (o.updatePorts) o.updatePorts();
        }
    }

    draw(ctx) {
        // base
        ctx.fillStyle = this.sticky ? '#4a6741' : '#555';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.55, this.sticky ? 'S-PIS' : 'PISTON');
        // head / arm
        if (this.extension > 0.5) {
            const hr = this.headRect();
            ctx.fillStyle = '#999';
            ctx.fillRect(hr.x, hr.y, Math.max(1, hr.w), Math.max(1, hr.h));
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(hr.x + 0.5, hr.y + 0.5, Math.max(0, hr.w - 1), Math.max(0, hr.h - 1));
            // head plate at tip
            ctx.fillStyle = this.sticky ? '#6a9a5a' : '#bbb';
            if (this.dir === 'right') ctx.fillRect(hr.x + hr.w - 6, hr.y - 2, 6, hr.h + 4);
            else if (this.dir === 'left') ctx.fillRect(hr.x, hr.y - 2, 6, hr.h + 4);
            else if (this.dir === 'down') ctx.fillRect(hr.x - 2, hr.y + hr.h - 6, hr.w + 4, 6);
            else ctx.fillRect(hr.x - 2, hr.y, hr.w + 4, 6);
        }
    }
}

class Piston extends PistonBase {
    constructor(x, y, dir = 'right') { super(x, y, false, dir); }
}

class StickyPiston extends PistonBase {
    constructor(x, y, dir = 'right') { super(x, y, true, dir); }
}

/** Door — solid when closed; passable when input is ON. */
class Door extends Obj {
    constructor(x, y, w = 20, h = 100) {
        super(x, y, w, h);
        this.outputPort = null;
        this.open = false;
        this.hp = 40;
        this.maxHp = 40;
        this.lastDamageAt = -999;
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

    get noCollision() { return this.open; }

    takeDamage(amount) {
        if (this.open) return;
        if (amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        this.lastDamageAt = performance.now() / 1000;
        spawnFloatText(this.x + this.w / 2, this.y + this.h / 2, '-' + Math.round(amount), '#60a5fa');
        spawnHitSpark(this.x + this.w / 2, this.y + this.h / 2, '#93c5fd');
        if (this.hp <= 0) {
            const i = objects.indexOf(this);
            if (i >= 0) objects.splice(i, 1);
        }
    }

    physicsTick(dt) {
        const now = performance.now() / 1000;
        if (this.hp < this.maxHp && now - this.lastDamageAt >= 20) {
            this.hp = this.maxHp;
        }
    }

    evaluate() {
        this.open = this.inputSignal(this.inputPort);
    }

    draw(ctx) {
        if (this.open) ctx.globalAlpha = 0.25;
        ctx.fillStyle = this.open ? '#3b82f6' : '#6b4c3b';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
        if (!this.open) {
            ctx.strokeStyle = '#3d2a20';
            ctx.beginPath();
            ctx.moveTo(this.x + this.w / 2, this.y + 4);
            ctx.lineTo(this.x + this.w / 2, this.y + this.h - 4);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ddd';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        if (this.h > this.w) ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.open ? 'OPEN' : 'DOOR', 0, 0);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        if (!this.open) drawHealthBar(ctx, this.x, this.y, this.w, this.hp, this.maxHp);
    }
}

/** Conveyor belt — when powered, slides overlapping objects along dir. */
class Conveyor extends Obj {
    constructor(x, y, dir = 'right') {
        super(x, y, 100, 28);
        this.outputPort = null;
        this.dir = dir;
        this.noCollision = true; // objects sit on top; no clamp bounce
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

    evaluate() {}

    physicsTick(dt) {
        if (!this.inputSignal(this.inputPort)) return;
        const speed = 55;
        let dx = 0, dy = 0;
        if (this.dir === 'right') dx = speed * dt;
        else if (this.dir === 'left') dx = -speed * dt;
        else if (this.dir === 'down') dy = speed * dt;
        else dy = -speed * dt;

        const moved = new Set();
        for (const o of objects) {
            if (o === this) continue;
            if (o.noCollision) continue;
            if (o instanceof Glue) continue;
            if (o instanceof Conveyor) continue;
            if (o instanceof PressurePlate) continue;
            if (!rectsOverlap(this.x, this.y - 2, this.w, this.h + 4, o.x, o.y, o.w, o.h)) continue;
            const group = getPhysicalGroup(o);
            for (const g of group) {
                if (moved.has(g)) continue;
                moved.add(g);
                g.x += dx;
                g.y += dy;
                g.x = clamp(g.x, g.w, canvas.width);
                g.y = clamp(g.y, g.h, canvas.height);
                if (g.updatePorts) g.updatePorts();
            }
        }
    }

    draw(ctx) {
        const on = this.inputPort && this.inputPort.powered;
        ctx.fillStyle = on ? '#3d4a3d' : '#2a2a2a';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
        // chevrons
        ctx.strokeStyle = on ? '#8f8' : '#555';
        ctx.lineWidth = 2;
        const t = on ? (performance.now() / 200) % 20 : 0;
        for (let i = 0; i < 5; i++) {
            const cx = this.x + 12 + i * 18 + t;
            const cy = this.y + this.h / 2;
            ctx.beginPath();
            if (this.dir === 'right') {
                ctx.moveTo(cx - 4, cy - 6);
                ctx.lineTo(cx + 4, cy);
                ctx.lineTo(cx - 4, cy + 6);
            } else if (this.dir === 'left') {
                ctx.moveTo(cx + 4, cy - 6);
                ctx.lineTo(cx - 4, cy);
                ctx.lineTo(cx + 4, cy + 6);
            }
            ctx.stroke();
        }
        ctx.fillStyle = '#aaa';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CONV', this.x + this.w / 2, this.y + this.h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
}

/**
 * Glue — green circle. Objects overlapping it form a rigid group.
 * Drag near rim to resize (10..50px). E toggles detach (stops sticking without deleting).
 */
class Glue extends Obj {
    constructor(x, y, radius = 22) {
        const r = Math.max(10, Math.min(50, radius));
        super(x - r, y - r, r * 2, r * 2);
        this.inputPort = null;
        this.outputPort = null;
        this.radius = r;
        this.noCollision = true;
        this.isGlue = true;
        this.active = true; // false = detached, no sticking
    }

    get centerX() { return this.x + this.w / 2; }
    get centerY() { return this.y + this.h / 2; }

    setRadius(r) {
        r = Math.max(10, Math.min(50, r));
        const cx = this.centerX;
        const cy = this.centerY;
        this.radius = r;
        this.w = r * 2;
        this.h = r * 2;
        this.x = cx - r;
        this.y = cy - r;
    }

    contains(px, py) {
        return dist(px, py, this.centerX, this.centerY) <= this.radius;
    }

    /** True if object body intersects this glue circle. */
    overlapsObject(o) {
        if (!this.active) return false;
        const cx = this.centerX;
        const cy = this.centerY;
        const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
        const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
        return dist(cx, cy, nx, ny) <= this.radius;
    }

    getPorts() { return []; }
    evaluate() {}
    updatePorts() {}

    draw(ctx) {
        const cx = this.centerX;
        const cy = this.centerY;
        const r = this.radius;
        if (!this.active) ctx.globalAlpha = 0.35;
        const grd = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
        grd.addColorStop(0, 'rgba(120, 220, 100, 0.55)');
        grd.addColorStop(0.7, 'rgba(40, 160, 70, 0.4)');
        grd.addColorStop(1, 'rgba(20, 100, 40, 0.25)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // bubble highlights
        ctx.fillStyle = 'rgba(200, 255, 180, 0.35)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + r * 0.2, cy + r * 0.15, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        // rim
        ctx.strokeStyle = 'rgba(30, 120, 50, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
        ctx.stroke();
        // sticky strands
        ctx.strokeStyle = 'rgba(80, 180, 90, 0.5)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.4;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3);
            ctx.quadraticCurveTo(
                cx + Math.cos(a + 0.5) * r * 0.7,
                cy + Math.sin(a + 0.5) * r * 0.7,
                cx + Math.cos(a + 0.2) * (r - 3),
                cy + Math.sin(a + 0.2) * (r - 3)
            );
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (!this.active) {
            ctx.fillStyle = '#ccc';
            ctx.font = '9px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('DETACHED', cx, cy);
            ctx.textAlign = 'left';
        }
    }
}




// ---------- Signal utilities ----------

class SignalSplit extends Obj {
    constructor(x, y) {
        super(x, y, 70, 56);
        this.outputPort = null;
        this.outputA = new Port(0, 0, 'output', this);
        this.outputB = new Port(0, 0, 'output', this);
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
        if (this.outputA) {
            this.outputA.x = this.x + this.w * 0.3;
            this.outputA.y = this.y + this.h;
            if (this.outputA.connectedTo && this.outputA.connectedTo.owner.isWire) {
                this.outputA.connectedTo.x = this.outputA.x;
                this.outputA.connectedTo.y = this.outputA.y;
            }
        }
        if (this.outputB) {
            this.outputB.x = this.x + this.w * 0.7;
            this.outputB.y = this.y + this.h;
            if (this.outputB.connectedTo && this.outputB.connectedTo.owner.isWire) {
                this.outputB.connectedTo.x = this.outputB.x;
                this.outputB.connectedTo.y = this.outputB.y;
            }
        }
    }

    evaluate() {
        const v = this.inputSignal(this.inputPort);
        this.outputA.powered = v;
        this.outputB.powered = v;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.55, 'SPLIT');
        ctx.fillStyle = '#888';
        ctx.font = '8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Y', this.x + this.w * 0.3, this.y + this.h - 6);
        ctx.fillText('Y', this.x + this.w * 0.7, this.y + this.h - 6);
        ctx.textAlign = 'left';
    }
}

/** Extends ON for delayMs after input falls. Double-click to edit 100–1000 ms. */
class SignalSustain extends Obj {
    constructor(x, y) {
        super(x, y, 78, 56);
        this.delayMs = 300;
        this.hold = 0;
        this._out = false;
        this.updatePorts();
    }

    setDelayMs(v) {
        v = Math.round(Number(v));
        if (!Number.isFinite(v)) v = 300;
        this.delayMs = Math.max(100, Math.min(1000, v));
    }

    physicsTick(dt) {
        const on = this.inputSignal(this.inputPort);
        if (on) {
            this._out = true;
            this.hold = this.delayMs / 1000;
        } else if (this.hold > 0) {
            this.hold -= dt;
            this._out = this.hold > 0;
        } else {
            this._out = false;
        }
    }

    evaluate() {
        this.outputPort.powered = this._out;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.45, 'SUSTAIN');
        ctx.fillStyle = '#9ca3af';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.delayMs + 'ms', this.x + this.w / 2, this.y + this.h * 0.72);
        ctx.textAlign = 'left';
    }
}

/** Delays signal by delayMs. Double-click to edit 100–1000 ms. */
class SignalDelay extends Obj {
    constructor(x, y) {
        super(x, y, 78, 56);
        this.delayMs = 300;
        this.now = 0;
        this.hist = [];
        this._out = false;
        this.updatePorts();
    }

    setDelayMs(v) {
        v = Math.round(Number(v));
        if (!Number.isFinite(v)) v = 300;
        this.delayMs = Math.max(100, Math.min(1000, v));
    }

    physicsTick(dt) {
        this.now += dt;
        const v = this.inputSignal(this.inputPort);
        this.hist.push({ t: this.now, v });
        const target = this.now - this.delayMs / 1000;
        let out = false;
        for (const s of this.hist) {
            if (s.t <= target) out = s.v;
        }
        this._out = out;
        this.hist = this.hist.filter(s => s.t >= target - 0.05);
    }

    evaluate() {
        this.outputPort.powered = this._out;
    }

    draw(ctx) {
        drawBody(ctx, this.x, this.y, this.w, this.h);
        drawLabel(ctx, this.x, this.y, this.w, this.h * 0.45, 'DELAY');
        ctx.fillStyle = '#9ca3af';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.delayMs + 'ms', this.x + this.w / 2, this.y + this.h * 0.72);
        ctx.textAlign = 'left';
    }
}

// ---------- Combat entities ----------

const PROJ_MAX_SPEED = 520;
const PROJ_MIN_SPEED = 80;
let explosions = [];
let floatingTexts = []; // {x,y,vy,text,color,age,life}
let hitSparks = [];     // {x,y,age,life,color}
let muzzleFlashes = []; // {x,y,angle,age,life}

function spawnFloatText(x, y, text, color) {
    if (floatingTexts.length > 48) floatingTexts.shift();
    floatingTexts.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y,
        vy: -36 - Math.random() * 18,
        text: String(text),
        color: color,
        age: 0,
        life: 0.85
    });
}

function spawnHitSpark(x, y, color) {
    if (hitSparks.length > 40) hitSparks.shift();
    hitSparks.push({ x, y, age: 0, life: 0.28, color: color || '#fca5a5' });
}

function spawnMuzzle(x, y, angle) {
    if (muzzleFlashes.length > 20) muzzleFlashes.shift();
    muzzleFlashes.push({ x, y, angle, age: 0, life: 0.12 });
}

function drawOutlinedText(ctx, text, x, y, fill) {
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

function angleDiff(a, b) {
    return ((b - a + 540) % 360) - 180;
}

function nearestEnemies(x, y, n) {
    const list = enemies.filter(e => !e.dead).map(e => ({
        e,
        d: dist(x, y, e.x + e.w / 2, e.y + e.h / 2)
    }));
    list.sort((a, b) => a.d - b.d);
    return list.slice(0, n).map(x => x.e);
}

/** Shared projectile: linger when blocked by crate/door instead of despawning. */
class Projectile {
    constructor(x, y, angleDeg, speed, opts = {}) {
        this.x = x;
        this.y = y;
        this.angle = angleDeg;
        this.speed = Math.min(PROJ_MAX_SPEED, Math.max(PROJ_MIN_SPEED, speed));
        this.damage = opts.damage != null ? opts.damage : 15;
        this.lifetime = opts.lifetime != null ? opts.lifetime : 10;
        this.age = 0;
        this.dead = false;
        this.blocked = false;
        this.kind = opts.kind || 'arrow';
        this.home = !!opts.home;
        this.maxTurn = opts.maxTurn != null ? opts.maxTurn : 0; // deg/s
        this.aoe = opts.aoe || null; // { radius, damage }
        this.onExplode = opts.onExplode || null;
    }

    get isWire() { return false; }

    applyConveyors(dt) {
        for (const o of objects) {
            if (!(o instanceof Conveyor)) continue;
            if (!o.inputSignal(o.inputPort)) continue;
            if (!rectsOverlap(this.x - 3, this.y - 3, 6, 6, o.x, o.y, o.w, o.h)) continue;
            let cAng = 0;
            if (o.dir === 'right') cAng = 0;
            else if (o.dir === 'left') cAng = 180;
            else if (o.dir === 'down') cAng = 90;
            else cAng = 270;
            const diff = angleDiff(this.angle, cAng);
            this.angle += diff * Math.min(1, 2.5 * dt);
            const align = Math.cos(diff * Math.PI / 180);
            this.speed += align * 180 * dt;
            this.speed = Math.min(PROJ_MAX_SPEED, Math.max(PROJ_MIN_SPEED, this.speed));
        }
    }

    blockedBySolid(nx, ny) {
        for (const o of objects) {
            if (o instanceof Door && !o.open) {
                if (rectsOverlap(nx - 2, ny - 2, 4, 4, o.x, o.y, o.w, o.h)) return true;
            }
            if (o instanceof Crate) {
                if (rectsOverlap(nx - 2, ny - 2, 4, 4, o.x, o.y, o.w, o.h)) return true;
            }
        }
        return false;
    }

    tick(dt) {
        if (this.dead) return;
        this.age += dt;
        if (this.age >= this.lifetime) {
            this.dead = true;
            return;
        }

        // Homing
        if (this.home) {
            const targets = nearestEnemies(this.x, this.y, 1);
            if (targets.length) {
                const e = targets[0];
                const desired = Math.atan2(e.y + e.h / 2 - this.y, e.x + e.w / 2 - this.x) * 180 / Math.PI;
                const diff = angleDiff(this.angle, desired);
                const maxStep = this.maxTurn * dt;
                this.angle += Math.max(-maxStep, Math.min(maxStep, diff));
            }
        }

        this.applyConveyors(dt);

        const rad = this.angle * Math.PI / 180;
        const nx = this.x + Math.cos(rad) * this.speed * dt;
        const ny = this.y + Math.sin(rad) * this.speed * dt;

        if (this.blockedBySolid(nx, ny)) {
            if (this.kind === 'rocket' && this.aoe) {
                // direct half-damage to the solid we struck, then detonate
                this.damageFriendlyAt(nx, ny, (this.damage || 0) * 0.5);
                this.x = nx;
                this.y = ny;
                this.explode();
                return;
            }
            // other projectiles linger until despawn timer
            this.blocked = true;
        } else {
            this.blocked = false;
            this.x = nx;
            this.y = ny;
        }

        // Hit enemies
        for (const e of enemies) {
            if (e.dead) continue;
            if (!rectsOverlap(this.x - 4, this.y - 4, 8, 8, e.x, e.y, e.w, e.h)) continue;
            if (this.aoe) {
                // impact damage then AoE
                e.takeHit(this);
                this.explode();
            } else {
                e.takeHit(this);
                this.dead = true;
            }
            return;
        }

        if (this.x < -60 || this.y < -60 || this.x > canvas.width + 60 || this.y > canvas.height + 60) {
            this.dead = true;
        }
    }

    damageFriendlyAt(nx, ny, amount) {
        if (amount <= 0) return;
        for (const o of objects) {
            if (o instanceof Door && !o.open) {
                if (rectsOverlap(nx - 2, ny - 2, 4, 4, o.x, o.y, o.w, o.h)) {
                    if (typeof o.takeDamage === 'function') o.takeDamage(amount);
                }
            }
            if (o instanceof Crate) {
                if (rectsOverlap(nx - 2, ny - 2, 4, 4, o.x, o.y, o.w, o.h)) {
                    if (typeof o.takeDamage === 'function') o.takeDamage(amount);
                }
            }
        }
    }

    explode() {
        if (this.dead) return;
        this.dead = true;
        if (!this.aoe) return;
        const R = this.aoe.radius;
        const dmg = this.aoe.damage;
        for (const e of enemies) {
            if (e.dead) continue;
            const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
            if (dist(this.x, this.y, cx, cy) <= R) {
                e.takeHit({ angle: this.angle, speed: this.speed, damage: dmg });
            }
        }
        // Friendly fire: half AoE to crates / closed doors
        const friendly = dmg * 0.5;
        for (const o of objects) {
            if (o instanceof Crate) {
                const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
                if (dist(this.x, this.y, cx, cy) <= R && typeof o.takeDamage === 'function') {
                    o.takeDamage(friendly);
                }
            }
            if (o instanceof Door && !o.open) {
                const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
                if (dist(this.x, this.y, cx, cy) <= R && typeof o.takeDamage === 'function') {
                    o.takeDamage(friendly);
                }
            }
        }
        explosions.push({
            x: this.x, y: this.y, r: 8, maxR: R, age: 0, life: 0.55,
            particles: Array.from({ length: 10 }, () => ({
                ang: Math.random() * Math.PI * 2,
                spd: 40 + Math.random() * 140,
                life: 0.25 + Math.random() * 0.3
            }))
        });
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle * Math.PI / 180);
        if (this.kind === 'rocket') {
            ctx.fillStyle = '#f97316';
            ctx.fillRect(-10, -4, 18, 8);
            ctx.fillStyle = '#78716c';
            ctx.fillRect(-12, -5, 4, 10);
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.moveTo(8, 0); ctx.lineTo(16, -5); ctx.lineTo(16, 5); ctx.closePath();
            ctx.fill();
        } else if (this.kind === 'bolt') {
            ctx.fillStyle = '#a8a29e';
            ctx.fillRect(-12, -2.5, 20, 5);
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.moveTo(8, 0); ctx.lineTo(16, -4); ctx.lineTo(16, 4); ctx.closePath();
            ctx.fill();
        } else if (this.kind === 'pellet') {
            ctx.fillStyle = '#e5e5e5';
            ctx.beginPath();
            ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#555';
            ctx.stroke();
        } else {
            ctx.fillStyle = '#d4d4d8';
            ctx.fillRect(-8, -1.5, 14, 3);
            ctx.fillStyle = '#888';
            ctx.beginPath();
            ctx.moveTo(6, 0); ctx.lineTo(12, -3); ctx.lineTo(12, 3); ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#b91c1c';
            ctx.fillRect(-10, -2.5, 4, 5);
        }
        if (this.blocked) {
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,200,50,0.7)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, 7, 0, Math.PI * 2);
            ctx.stroke();
            return;
        }
        ctx.restore();
    }
}

// keep name Arrow for compatibility
class Arrow extends Projectile {
    constructor(x, y, angleDeg, speed = 400) {
        super(x, y, angleDeg, speed, { damage: 15, lifetime: 10, kind: 'arrow' });
    }
}

/** Shared turret: FIRE + RELOAD inputs, ammo, cooldown, reload. */
class WeaponTurret extends Obj {
    constructor(x, y, w, h, cfg) {
        super(x, y, w, h);
        this.inputPort = null;
        this.outputPort = null;
        this.shootPort = new Port(0, 0, 'input', this);
        this.reloadPort = new Port(0, 0, 'input', this);
        this.ammo = cfg.ammo;
        this.maxAmmo = cfg.ammo;
        this.ammoPerShot = cfg.ammoPerShot || 1;
        this.cooldown = 0;
        this.reloading = false;
        this.reloadTimer = 0;
        this.reloadDuration = cfg.reload;
        this.shootCooldown = cfg.cooldown;
        this.prevShoot = false;
        this.prevReload = false;
        this.weaponLabel = cfg.label || 'GUN';
        this.updatePorts();
    }

    updatePorts() {
        if (this.shootPort) {
            this.shootPort.x = this.x + this.w * 0.3;
            this.shootPort.y = this.y;
            if (this.shootPort.connectedTo && this.shootPort.connectedTo.owner.isWire) {
                this.shootPort.connectedTo.x = this.shootPort.x;
                this.shootPort.connectedTo.y = this.shootPort.y;
            }
        }
        if (this.reloadPort) {
            this.reloadPort.x = this.x + this.w * 0.7;
            this.reloadPort.y = this.y;
            if (this.reloadPort.connectedTo && this.reloadPort.connectedTo.owner.isWire) {
                this.reloadPort.connectedTo.x = this.reloadPort.x;
                this.reloadPort.connectedTo.y = this.reloadPort.y;
            }
        }
    }

    facingAngle() { return this.angle; }

    findTargetAngle() {
        const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
        const t = nearestEnemies(cx, cy, 1);
        if (!t.length) return this.facingAngle();
        const e = t[0];
        return Math.atan2(e.y + e.h / 2 - cy, e.x + e.w / 2 - cx) * 180 / Math.PI;
    }

    /** Override in subclasses to spawn projectiles. Return true if shot fired. */
    fireProjectiles() { return false; }

    tryShoot() {
        if (this.reloading) return;
        if (this.cooldown > 0) return;
        if (this.ammo < this.ammoPerShot) {
            this.startReload();
            return;
        }
        if (!this.fireProjectiles()) return;
        this.ammo -= this.ammoPerShot;
        this.cooldown = this.shootCooldown;
        if (this.ammo < this.ammoPerShot) this.startReload();
    }

    startReload() {
        if (this.reloading) return;
        if (this.ammo >= this.maxAmmo) return;
        this.reloading = true;
        this.reloadTimer = 0;
    }

    evaluate() {}

    physicsTick(dt) {
        if (this.cooldown > 0) this.cooldown -= dt;
        if (this.reloading) {
            this.reloadTimer += dt;
            if (this.reloadTimer >= this.reloadDuration) {
                this.ammo = this.maxAmmo;
                this.reloading = false;
                this.reloadTimer = 0;
            }
        }
        const shoot = this.inputSignal(this.shootPort);
        const reload = this.inputSignal(this.reloadPort);
        if (shoot) this.tryShoot();
        if (reload && !this.prevReload) this.startReload();
        this.prevShoot = shoot;
        this.prevReload = reload;
    }

    drawWeaponArt(ctx) {
        // override — drawn in local space with origin at center, facing +X
    }

    draw(ctx) {
        const cx = this.x + this.w / 2;
        const cy = this.y + this.h / 2;
        // base plate
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(this.x + 4, this.y + this.h - 14, this.w - 8, 12);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 4.5, this.y + this.h - 13.5, this.w - 9, 11);

        // art faces +X in local center space; parent loop applies this.angle
        ctx.save();
        ctx.translate(cx, cy);
        this.drawWeaponArt(ctx);
        ctx.restore();

        ctx.fillStyle = '#9ca3af';
        ctx.font = '8px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FIRE', this.x + this.w * 0.28, this.y + 10);
        ctx.fillText('RLOD', this.x + this.w * 0.72, this.y + 10);
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillText(this.reloading ? '…' : (this.ammo + '/' + this.maxAmmo), cx, this.y + this.h - 5);
        ctx.textAlign = 'left';
        if (this.reloading) {
            const t = this.reloadTimer / this.reloadDuration;
            ctx.fillStyle = '#111';
            ctx.fillRect(this.x + 10, this.y + this.h - 3, this.w - 20, 3);
            ctx.fillStyle = '#eab308';
            ctx.fillRect(this.x + 10, this.y + this.h - 3, (this.w - 20) * t, 3);
        }
    }

    /** Call when firing for muzzle VFX. */
    flashMuzzle(ang) {
        const rad = ang * Math.PI / 180;
        spawnMuzzle(this.x + this.w / 2 + Math.cos(rad) * 30, this.y + this.h / 2 + Math.sin(rad) * 30, ang);
    }
}

class Crossbow extends WeaponTurret {
    constructor(x, y) {
        super(x, y, 70, 48, { ammo: 5, cooldown: 0.3, reload: 3, label: 'XBOW' });
    }
    fireProjectiles() {
        const ang = this.findTargetAngle();
        const rad = ang * Math.PI / 180;
        const cx = this.x + this.w / 2 + Math.cos(rad) * 28;
        const cy = this.y + this.h / 2 + Math.sin(rad) * 28;
        arrows.push(new Arrow(cx, cy, ang, 400));
        this.flashMuzzle(ang);
        return true;
    }
    drawWeaponArt(ctx) {
        // local space, facing +X, origin center
        // stock
        ctx.fillStyle = '#7c2d12';
        ctx.fillRect(-28, -5, 18, 10);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-28, -5, 18, 10);
        // body / prod
        ctx.fillStyle = '#a8a29e';
        ctx.fillRect(-12, -3, 26, 6);
        ctx.strokeRect(-12, -3, 26, 6);
        // bow limbs
        ctx.strokeStyle = '#d6d3d1';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(6, -16);
        ctx.quadraticCurveTo(18, -10, 14, 0);
        ctx.quadraticCurveTo(18, 10, 6, 16);
        ctx.stroke();
        // string
        ctx.strokeStyle = '#e7e5e4';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, -16);
        ctx.lineTo(-2, 0);
        ctx.lineTo(6, 16);
        ctx.stroke();
        // bolt resting
        if (!this.reloading && this.ammo > 0) {
            ctx.fillStyle = '#e5e5e5';
            ctx.fillRect(-4, -1.5, 22, 3);
            ctx.fillStyle = '#b91c1c';
            ctx.fillRect(-6, -2.5, 3, 5);
        }
    }
}

class Ballista extends WeaponTurret {
    constructor(x, y) {
        super(x, y, 78, 52, { ammo: 2, cooldown: 0.5, reload: 3, label: 'BALISTA' });
    }
    fireProjectiles() {
        const ang = this.findTargetAngle();
        const rad = ang * Math.PI / 180;
        const cx = this.x + this.w / 2 + Math.cos(rad) * 32;
        const cy = this.y + this.h / 2 + Math.sin(rad) * 32;
        arrows.push(new Projectile(cx, cy, ang, 360, { damage: 40, lifetime: 10, kind: 'bolt' }));
        this.flashMuzzle(ang);
        return true;
    }
    drawWeaponArt(ctx) {
        // heavy frame
        ctx.fillStyle = '#44403c';
        ctx.fillRect(-30, -10, 20, 20);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-30, -10, 20, 20);
        // rails
        ctx.fillStyle = '#78716c';
        ctx.fillRect(-12, -5, 34, 10);
        ctx.strokeRect(-12, -5, 34, 10);
        // winch wheels
        ctx.fillStyle = '#a8a29e';
        ctx.beginPath(); ctx.arc(-22, -12, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-22, 12, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.beginPath(); ctx.arc(-22, -12, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(-22, 12, 5, 0, Math.PI * 2); ctx.stroke();
        // large bolt
        if (!this.reloading && this.ammo > 0) {
            ctx.fillStyle = '#d6d3d1';
            ctx.fillRect(-6, -2.5, 28, 5);
            ctx.fillStyle = '#292524';
            ctx.beginPath();
            ctx.moveTo(22, 0); ctx.lineTo(30, -4); ctx.lineTo(30, 4); ctx.closePath();
            ctx.fill();
        }
    }
}

class Scatterbow extends WeaponTurret {
    constructor(x, y) {
        super(x, y, 74, 50, { ammo: 9, ammoPerShot: 3, cooldown: 0.35, reload: 4, label: 'SCATTER' });
    }
    fireProjectiles() {
        const cx0 = this.x + this.w / 2;
        const cy0 = this.y + this.h / 2;
        let targets = nearestEnemies(cx0, cy0, 3);
        if (targets.length === 0) {
            // fire three along facing with slight spread
            const base = this.facingAngle();
            for (let i = -1; i <= 1; i++) {
                const ang = base + i * 12;
                const rad = ang * Math.PI / 180;
                arrows.push(new Projectile(
                    cx0 + Math.cos(rad) * 26, cy0 + Math.sin(rad) * 26, ang, 420,
                    { damage: 10, lifetime: 10, kind: 'pellet' }
                ));
            }
            this.flashMuzzle(base);
            return true;
        }
        while (targets.length < 3) targets.push(targets[0]);
        let lastAng = this.facingAngle();
        for (let i = 0; i < 3; i++) {
            const e = targets[i];
            const ang = Math.atan2(e.y + e.h / 2 - cy0, e.x + e.w / 2 - cx0) * 180 / Math.PI;
            lastAng = ang;
            const rad = ang * Math.PI / 180;
            arrows.push(new Projectile(
                cx0 + Math.cos(rad) * 26, cy0 + Math.sin(rad) * 26, ang, 420,
                { damage: 10, lifetime: 10, kind: 'pellet' }
            ));
        }
        this.flashMuzzle(lastAng);
        return true;
    }
    drawWeaponArt(ctx) {
        // triple prod
        ctx.fillStyle = '#57534e';
        ctx.fillRect(-24, -8, 16, 16);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-24, -8, 16, 16);
        for (let i = -1; i <= 1; i++) {
            ctx.strokeStyle = '#d6d3d1';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-6, i * 7);
            ctx.quadraticCurveTo(12, i * 12, 18, i * 6);
            ctx.stroke();
            // pellet tips
            if (!this.reloading && this.ammo > 0) {
                ctx.fillStyle = '#e5e5e5';
                ctx.beginPath();
                ctx.arc(14, i * 6, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

class RocketLauncher extends WeaponTurret {
    constructor(x, y) {
        super(x, y, 80, 54, { ammo: 1, cooldown: 0.4, reload: 2, label: 'ROCKET' });
    }
    fireProjectiles() {
        const ang = this.findTargetAngle();
        const rad = ang * Math.PI / 180;
        const cx = this.x + this.w / 2 + Math.cos(rad) * 30;
        const cy = this.y + this.h / 2 + Math.sin(rad) * 30;
        arrows.push(new Projectile(cx, cy, ang, 150, {
            damage: 10,
            lifetime: 20,
            kind: 'rocket',
            home: true,
            maxTurn: 40,
            aoe: { radius: 150, damage: 60 }
        }));
        this.flashMuzzle(ang);
        return true;
    }
    drawWeaponArt(ctx) {
        // tube
        ctx.fillStyle = '#292524';
        ctx.fillRect(-28, -9, 48, 18);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-28, -9, 48, 18);
        // bands
        ctx.fillStyle = '#78716c';
        ctx.fillRect(-20, -9, 4, 18);
        ctx.fillRect(4, -9, 4, 18);
        // muzzle
        ctx.fillStyle = '#44403c';
        ctx.fillRect(18, -11, 10, 22);
        ctx.strokeRect(18, -11, 10, 22);
        // loaded rocket nose
        if (!this.reloading && this.ammo > 0) {
            ctx.fillStyle = '#f97316';
            ctx.beginPath();
            ctx.moveTo(8, 0); ctx.lineTo(20, -6); ctx.lineTo(20, 6); ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fdba74';
            ctx.fillRect(-8, -4, 16, 8);
        }
        // rear fins
        ctx.fillStyle = '#a8a29e';
        ctx.beginPath();
        ctx.moveTo(-28, -9); ctx.lineTo(-34, -14); ctx.lineTo(-28, -4); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-28, 9); ctx.lineTo(-34, 14); ctx.lineTo(-28, 4); ctx.fill();
    }
}

class Core extends Obj {
    constructor(x, y) {
        super(x, y, 64, 64);
        this.outputPort = null;
        this.inputPort = null;
        this.healPort = new Port(0, 0, 'input', this);
        this.hp = 100;
        this.maxHp = 100;
        this.healCooldown = 0;
        this.healCooldownMax = 10;
        this.healAmount = 20;
        this.prevHeal = false;
        this.particles = [];
        this.updatePorts();
    }

    updatePorts() {
        if (this.healPort) {
            this.healPort.x = this.x + this.w / 2;
            this.healPort.y = this.y;
            if (this.healPort.connectedTo && this.healPort.connectedTo.owner.isWire) {
                this.healPort.connectedTo.x = this.healPort.x;
                this.healPort.connectedTo.y = this.healPort.y;
            }
        }
    }

    takeDamage(amount) {
        if (amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        spawnFloatText(this.x + this.w / 2, this.y, '-' + Math.round(amount), '#60a5fa');
        spawnHitSpark(this.x + this.w / 2, this.y + this.h / 2, '#93c5fd');
        if (this.hp <= 0) {
            triggerGameOver();
        }
    }

    tryHeal() {
        if (this.healCooldown > 0) return;
        if (this.hp >= this.maxHp) return;
        const before = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + this.healAmount);
        const gained = this.hp - before;
        this.healCooldown = this.healCooldownMax;
        if (gained > 0) {
            spawnFloatText(this.x + this.w / 2, this.y, '+' + Math.round(gained), '#4ade80');
        }
        for (let i = 0; i < 12; i++) {
            this.particles.push({
                x: this.x + this.w / 2,
                y: this.y + this.h / 2,
                vx: (Math.random() - 0.5) * 80,
                vy: (Math.random() - 0.5) * 80 - 20,
                life: 0.6 + Math.random() * 0.4
            });
        }
    }

    evaluate() {}

    physicsTick(dt) {
        if (this.healCooldown > 0) this.healCooldown -= dt;
        const on = this.inputSignal(this.healPort);
        if (on) this.tryHeal(); // continuous: every 10s while powered
        this.prevHeal = on;
        for (const p of this.particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
        }
        this.particles = this.particles.filter(p => p.life > 0);
    }

    draw(ctx) {
        // body
        const grd = ctx.createRadialGradient(
            this.x + this.w / 2, this.y + this.h / 2, 4,
            this.x + this.w / 2, this.y + this.h / 2, this.w / 2
        );
        grd.addColorStop(0, '#67e8f9');
        grd.addColorStop(1, '#0e7490');
        ctx.fillStyle = grd;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
        ctx.fillStyle = '#ecfeff';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CORE', this.x + this.w / 2, this.y + this.h / 2 - 6);
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(Math.ceil(this.hp) + '/' + this.maxHp, this.x + this.w / 2, this.y + this.h / 2 + 10);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        // heal cooldown ring
        if (this.healCooldown > 0) {
            const t = 1 - this.healCooldown / this.healCooldownMax;
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2 - 4, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
            ctx.stroke();
        }
        for (const p of this.particles) {
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = '#a5f3fc';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        drawHealthBar(ctx, this.x, this.y, this.w, this.hp, this.maxHp);
    }
}

class Enemy {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.w = 28;
        this.h = 28;
        this.speed = 40;
        this.hp = 30;
        this.maxHp = 30;
        this.attackTimer = 0;
        this.attackInterval = 5;
        this.damage = 20;
        this.dead = false;
        this.vx = 0;
        this.vy = 0;
    }

    takeHit(proj) {
        const dmg = (proj && proj.damage != null) ? proj.damage : 15;
        if (dmg > 0) {
            this.hp -= dmg;
            spawnFloatText(this.x + this.w / 2, this.y, '-' + Math.round(dmg), '#f87171');
            spawnHitSpark(this.x + this.w / 2, this.y + this.h / 2, '#fca5a5');
        }
        const rad = ((proj && proj.angle) || 0) * Math.PI / 180;
        const spd = (proj && proj.speed) || 200;
        const kb = Math.min(120, Math.max(30, spd * 0.15));
        this.vx += Math.cos(rad) * kb;
        this.vy += Math.sin(rad) * kb;
        if (this.hp <= 0) this.dead = true;
    }

    tick(dt) {
        if (this.dead) return;
        // damp knockback
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= Math.pow(0.05, dt);
        this.vy *= Math.pow(0.05, dt);

        const core = getCore();
        if (core) {
            const cx = core.x + core.w / 2;
            const cy = core.y + core.h / 2;
            const mx = this.x + this.w / 2;
            const my = this.y + this.h / 2;
            const dx = cx - mx;
            const dy = cy - my;
            const d = Math.hypot(dx, dy) || 1;
            let nx = this.x + (dx / d) * this.speed * dt;
            let ny = this.y + (dy / d) * this.speed * dt;

            // collision with closed doors, crates, core
            const blockers = objects.filter(o =>
                (o instanceof Door && !o.open) || o instanceof Crate || o instanceof Core
            );
            let blocked = false;
            let blockedObj = null;
            for (const o of blockers) {
                if (rectsOverlap(nx, ny, this.w, this.h, o.x, o.y, o.w, o.h)) {
                    blocked = true;
                    blockedObj = o;
                    break;
                }
            }
            if (!blocked) {
                this.x = nx;
                this.y = ny;
            } else {
                this.attackTimer += dt;
                if (this.attackTimer >= this.attackInterval) {
                    this.attackTimer = 0;
                    if (blockedObj && typeof blockedObj.takeDamage === 'function') {
                        blockedObj.takeDamage(this.damage);
                    }
                }
            }
        }
        // pixel snap
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
    }

    draw(ctx) {
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
        drawHealthBar(ctx, this.x, this.y, this.w, this.hp, this.maxHp);
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
let hoveredGlue = null;
let lastTime = performance.now();
let shiftHeld = false;
let eHeld = false;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

// ---------- sandbox / wave mode ----------

let onTitleScreen = true;
let editingNumber = null;
let editingDelay = null;
let arrows = [];
let enemies = [];
let gameOver = false;
let gameWon = false;
let wave = 0;                 // current wave number (0 = pre-wave)
let wavePhase = 'intermission'; // intermission | combat | pick
let waveTimer = 30;           // seconds left in intermission or until next
let TOTAL_WAVES = 50;
let pausedForPick = false;

function getCore() {
    for (const o of objects) if (o instanceof Core) return o;
    return null;
}

const LOGIC_PICK_POOL = [
    { id: 'AND', label: 'AND', desc: 'Logic gate', spawn: (x, y) => new AND(x, y) },
    { id: 'OR', label: 'OR', desc: 'Logic gate', spawn: (x, y) => new OR(x, y) },
    { id: 'XOR', label: 'XOR', desc: 'Logic gate', spawn: (x, y) => new XOR(x, y) },
    { id: 'NOT', label: 'NOT', desc: 'Inverter', spawn: (x, y) => new NOT(x, y) },
    { id: 'NAND', label: 'NAND', desc: 'Logic gate', spawn: (x, y) => new NAND(x, y) },
    { id: 'NOR', label: 'NOR', desc: 'Logic gate', spawn: (x, y) => new NOR(x, y) },
    { id: 'XNOR', label: 'XNOR', desc: 'Logic gate', spawn: (x, y) => new XNOR(x, y) },
    { id: 'Battery', label: 'Battery', desc: 'Always ON', spawn: (x, y) => new Battery(x, y) },
    { id: 'Lever', label: 'Lever', desc: 'Toggle source', spawn: (x, y) => new Lever(x, y) },
    { id: 'Button', label: 'Button', desc: 'Hold to pulse', spawn: (x, y) => new Button(x, y) },
    { id: 'Clock', label: 'Clock', desc: 'Square wave', spawn: (x, y) => new Clock(x, y) },
    { id: 'Lamp', label: 'Lamp', desc: 'Light indicator', spawn: (x, y) => new Lamp(x, y) },
    { id: 'Crate', label: 'Crate', desc: 'Blocker (40 HP)', spawn: (x, y) => new Crate(x, y) },
    { id: 'Door', label: 'Door', desc: 'Openable wall', spawn: (x, y) => new Door(x, y) },
    { id: 'Plate', label: 'Pressure Plate', desc: 'Detect objects', spawn: (x, y) => new PressurePlate(x, y) },
    { id: 'Conveyor', label: 'Conveyor', desc: 'Moves things', spawn: (x, y) => new Conveyor(x, y) },
    { id: 'Piston', label: 'Piston', desc: 'Pushes', spawn: (x, y) => new Piston(x, y) },
    { id: 'StickyPiston', label: 'Sticky Piston', desc: 'Push & pull', spawn: (x, y) => new StickyPiston(x, y) },
    { id: 'Glue', label: 'Glue', desc: 'Stick objects', spawn: (x, y) => new Glue(x + 22, y + 22, 22) },
    { id: 'DFF', label: 'D Flip-Flop', desc: 'Memory', spawn: (x, y) => new DFlipFlop(x, y) },
    { id: 'TFF', label: 'T Flip-Flop', desc: 'Toggle memory', spawn: (x, y) => new TFlipFlop(x, y) },
    { id: 'Wire', label: 'Wire ×3', desc: 'Three wires', spawn: (x, y) => {
        wires.push(new Wire(x, y, x + 80, y));
        wires.push(new Wire(x, y + 20, x + 80, y + 20));
        wires.push(new Wire(x, y + 40, x + 80, y + 40));
        return null;
    }},
    { id: 'Bit4', label: '4-bit Number', desc: '0–15 source', spawn: (x, y) => new BitNumber(x, y, 4, 0, { label: '4u' }) },
    { id: 'Bit8', label: '8-bit Number', desc: '0–255 source', spawn: (x, y) => new BitNumber(x, y, 8, 0, { label: '8u' }) },
    { id: 'HalfAdder', label: 'Half Adder', desc: 'Sum + Carry', spawn: (x, y) => new HalfAdder(x, y) },
    { id: 'FullAdder', label: 'Full Adder', desc: '3-input adder', spawn: (x, y) => new FullAdder(x, y) },
    { id: 'Split', label: 'Signal Split', desc: '1 in → 2 out', spawn: (x, y) => new SignalSplit(x, y) },
    { id: 'Sustain', label: 'Signal Sustain', desc: 'Hold ON after fall', spawn: (x, y) => new SignalSustain(x, y) },
    { id: 'Delay', label: 'Signal Delay', desc: 'Delay signal', spawn: (x, y) => new SignalDelay(x, y) },
];

const WEAPON_PICK_POOL = [
    { id: 'Crossbow', label: 'Crossbow', desc: '15 dmg · 5 ammo · 0.3s', spawn: (x, y) => new Crossbow(x, y) },
    { id: 'Ballista', label: 'Ballista', desc: '40 dmg · 2 ammo · 0.5s', spawn: (x, y) => new Ballista(x, y) },
    { id: 'Scatterbow', label: 'Scatterbow', desc: '3×10 dmg · 9 ammo', spawn: (x, y) => new Scatterbow(x, y) },
    { id: 'Rocket', label: 'Rocket Launcher', desc: '60 AoE · homes · 1 ammo', spawn: (x, y) => new RocketLauncher(x, y) },
];

function buildSandboxKit() {
    objects = [];
    wires = [];
    arrows = [];
    enemies = [];
    explosions = [];
    floatingTexts = [];
    hitSparks = [];
    muzzleFlashes = [];
    gameOver = false;
    gameWon = false;
    wave = 0;
    wavePhase = 'intermission';
    waveTimer = 30;
    pausedForPick = false;
    document.getElementById('pick-overlay').hidden = true;
    document.getElementById('end-overlay').hidden = true;

    // Core
    objects.push(new Core(360, 260));

    // Required starter kit
    objects.push(new Battery(40, 40));
    objects.push(new Lever(140, 40));
    objects.push(new Clock(240, 40, 800));
    objects.push(new SignalSplit(40, 120));
    objects.push(new SignalDelay(140, 120));
    objects.push(new AND(40, 200));
    objects.push(new OR(150, 200));
    objects.push(new Crossbow(40, 280));
    objects.push(new Crossbow(130, 280));
    objects.push(new Ballista(220, 280));
    objects.push(new PressurePlate(40, 360));
    objects.push(new Crate(500, 240));
    objects.push(new Crate(500, 300));
    objects.push(new Door(560, 200, 18, 140));

    // 8 wires
    for (let i = 0; i < 8; i++) {
        wires.push(new Wire(40 + (i % 4) * 100, 420 + Math.floor(i / 4) * 36, 110 + (i % 4) * 100, 420 + Math.floor(i / 4) * 36));
    }
    updateWaveUI();
}

function updateWaveUI() {
    const title = document.getElementById('wave-title');
    const status = document.getElementById('wave-status');
    const coreHud = document.getElementById('core-hud');
    if (!title) return;
    title.textContent = 'Wave ' + Math.min(wave, TOTAL_WAVES) + ' / ' + TOTAL_WAVES;
    if (gameWon) status.textContent = 'Victory!';
    else if (gameOver) status.textContent = 'Core destroyed';
    else if (wavePhase === 'intermission') {
        if (wave === 0) status.textContent = 'Prepare — ' + Math.ceil(waveTimer) + 's';
        else status.textContent = 'Intermission — ' + Math.ceil(waveTimer) + 's';
    } else if (wavePhase === 'combat') {
        status.textContent = 'Enemies: ' + enemies.filter(e => !e.dead).length;
    } else if (wavePhase === 'pick') {
        status.textContent = 'Choose an upgrade';
    }
    const core = getCore();
    if (coreHud) {
        coreHud.textContent = core ? ('Core HP ' + Math.ceil(core.hp) + '/' + core.maxHp) : 'Core HP —';
    }
}

function spawnWave(n) {
    // scaling: more enemies each wave
    const count = Math.min(40, 2 + Math.floor(n * 1.2));
    for (let i = 0; i < count; i++) {
        // spawn at edges
        const side = Math.floor(Math.random() * 4);
        let x, y;
        if (side === 0) { x = Math.random() * canvas.width; y = -20; }
        else if (side === 1) { x = Math.random() * canvas.width; y = canvas.height + 4; }
        else if (side === 2) { x = -20; y = Math.random() * canvas.height; }
        else { x = canvas.width + 4; y = Math.random() * canvas.height; }
        const e = new Enemy(x, y);
        e.speed = 36 + Math.min(40, n * 0.6);
        e.hp = e.maxHp = 25 + Math.floor(n * 1.5);
        enemies.push(e);
    }
}

function samplePool(pool, n) {
    const copy = pool.slice();
    const out = [];
    while (out.length < n && copy.length) {
        const i = Math.floor(Math.random() * copy.length);
        out.push(copy.splice(i, 1)[0]);
    }
    return out;
}

function spawnPickItem(p) {
    const spawned = p.spawn(60 + Math.random() * 220, 60 + Math.random() * 160);
    if (spawned) objects.push(spawned);
}

/** Stage A: pick 2 of 4 logic/physics. Stage B: pick 1 of 3 weapons. */
function openPickUI() {
    pausedForPick = true;
    wavePhase = 'pick';
    openLogicPick();
}

function openLogicPick() {
    const overlay = document.getElementById('pick-overlay');
    const box = document.getElementById('pick-choices');
    const sub = document.querySelector('.pick-sub');
    const title = overlay.querySelector('h2');
    if (title) title.textContent = 'Logic & gear — pick 2 of 4';
    if (sub) sub.textContent = 'Select two components, then Confirm. (No weapons in this step.)';
    box.innerHTML = '';
    const picks = samplePool(LOGIC_PICK_POOL, 4);
    const selected = new Set();
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'pick-btn pick-confirm';
    confirm.textContent = 'Confirm (0/2)';
    confirm.disabled = true;

    function refreshConfirm() {
        confirm.textContent = 'Confirm (' + selected.size + '/2)';
        confirm.disabled = selected.size !== 2;
        for (const btn of box.querySelectorAll('.pick-btn[data-id]')) {
            btn.classList.toggle('selected', selected.has(btn.dataset.id));
        }
    }

    for (const p of picks) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pick-btn';
        btn.dataset.id = p.id;
        btn.innerHTML = p.label + '<span class="desc">' + p.desc + '</span>';
        btn.addEventListener('click', () => {
            if (selected.has(p.id)) selected.delete(p.id);
            else if (selected.size < 2) selected.add(p.id);
            refreshConfirm();
        });
        box.appendChild(btn);
    }
    confirm.addEventListener('click', () => {
        for (const p of picks) {
            if (selected.has(p.id)) spawnPickItem(p);
        }
        openWeaponPick();
    });
    box.appendChild(confirm);
    overlay.hidden = false;
    updateWaveUI();
}

function openWeaponPick() {
    const overlay = document.getElementById('pick-overlay');
    const box = document.getElementById('pick-choices');
    const sub = document.querySelector('.pick-sub');
    const title = overlay.querySelector('h2');
    if (title) title.textContent = 'Weapon — pick 1 of 3';
    if (sub) sub.textContent = 'Choose one weapon to add to the field.';
    box.innerHTML = '';
    const picks = samplePool(WEAPON_PICK_POOL, 3);
    for (const p of picks) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pick-btn';
        btn.innerHTML = p.label + '<span class="desc">' + p.desc + '</span>';
        btn.addEventListener('click', () => {
            spawnPickItem(p);
            overlay.hidden = true;
            pausedForPick = false;
            wavePhase = 'intermission';
            waveTimer = 20; // longer build time after upgrade picks
            updateWaveUI();
        });
        box.appendChild(btn);
    }
    overlay.hidden = false;
    updateWaveUI();
}

function triggerGameOver() {
    if (gameOver || gameWon) return;
    gameOver = true;
    const overlay = document.getElementById('end-overlay');
    document.getElementById('end-title').textContent = 'Game Over';
    document.getElementById('end-msg').textContent = 'The Core was destroyed on wave ' + wave + '.';
    overlay.hidden = false;
}

function triggerWin() {
    if (gameWon || gameOver) return;
    gameWon = true;
    const overlay = document.getElementById('end-overlay');
    document.getElementById('end-title').textContent = 'You Win!';
    document.getElementById('end-msg').textContent = 'All ' + TOTAL_WAVES + ' waves cleared.';
    overlay.hidden = false;
}

function tickWaves(dt) {
    if (onTitleScreen || gameOver || gameWon || pausedForPick) return;
    if (wavePhase === 'intermission') {
        waveTimer -= dt;
        if (waveTimer <= 0) {
            wave += 1;
            if (wave > TOTAL_WAVES) {
                triggerWin();
                return;
            }
            spawnWave(wave);
            wavePhase = 'combat';
        }
    } else if (wavePhase === 'combat') {
        const alive = enemies.some(e => !e.dead);
        if (!alive) {
            enemies = [];
            if (wave >= TOTAL_WAVES) {
                triggerWin();
                return;
            }
            if (wave > 0 && wave % 5 === 0) {
                openPickUI();
            } else {
                wavePhase = 'intermission';
                waveTimer = 5;
            }
        }
    }
    updateWaveUI();
}

function setPlayUI(playing) {
    onTitleScreen = !playing;
    const title = document.getElementById('title-screen');
    if (title) title.hidden = playing;
    const hud = document.getElementById('hud');
    if (hud) hud.hidden = !playing;
    const hint = document.getElementById('hint');
    if (hint) hint.hidden = !playing;
}

function showTitleScreen() {
    closeNumberEdit(false);
    objects = [];
    wires = [];
    arrows = [];
    enemies = [];
    drag = null;
    gameOver = false;
    gameWon = false;
    document.getElementById('pick-overlay').hidden = true;
    document.getElementById('end-overlay').hidden = true;
    setPlayUI(false);
}

function startSandbox() {
    closeNumberEdit(false);
    drag = null;
    buildSandboxKit();
    setPlayUI(true);
}

// ---- number editor ----

function openNumberEdit(bn) {
    const input = document.getElementById('num-edit');
    if (!input) return;
    editingNumber = bn;
    editingDelay = null;
    input.hidden = false;
    input.min = String(bn.minValue);
    input.max = String(bn.maxValue);
    input.step = '1';
    input.value = String(bn.value);
    positionNumberEdit();
    input.focus();
    input.select();
}

function openDelayEdit(comp) {
    const input = document.getElementById('num-edit');
    if (!input) return;
    editingNumber = null;
    editingDelay = comp;
    input.hidden = false;
    input.min = '100';
    input.max = '1000';
    input.step = '10';
    input.value = String(comp.delayMs);
    // position over component
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    input.style.left = (rect.left + (comp.x + 8) * scaleX) + 'px';
    input.style.top = (rect.top + (comp.y + comp.h * 0.12) * scaleY) + 'px';
    input.style.width = Math.max(56, (comp.w - 16) * scaleX) + 'px';
    input.focus();
    input.select();
}

function positionNumberEdit() {
    const input = document.getElementById('num-edit');
    if (!input || !editingNumber) return;
    const bn = editingNumber;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    input.style.left = (rect.left + (bn.x + 8) * scaleX) + 'px';
    input.style.top = (rect.top + (bn.y + bn.h * 0.12) * scaleY) + 'px';
    input.style.width = Math.max(56, (bn.w - 16) * scaleX) + 'px';
}

function closeNumberEdit(apply) {
    const input = document.getElementById('num-edit');
    if (!input) return;
    if (apply && editingNumber) editingNumber.setValue(input.value);
    if (apply && editingDelay) editingDelay.setDelayMs(input.value);
    editingNumber = null;
    editingDelay = null;
    input.hidden = true;
}

const _numEditEl = document.getElementById('num-edit');
if (_numEditEl) {
    _numEditEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); closeNumberEdit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); closeNumberEdit(false); }
    });
    _numEditEl.addEventListener('blur', () => closeNumberEdit(true));
}

document.getElementById('btn-play').addEventListener('click', () => startSandbox());
document.getElementById('btn-menu').addEventListener('click', () => showTitleScreen());
document.getElementById('btn-restart').addEventListener('click', () => startSandbox());
document.getElementById('btn-end-menu').addEventListener('click', () => showTitleScreen());

function deleteDraggedObject() {
    if (!drag) return;
    if (drag.kind !== 'group') return;
    const targets = drag.group && drag.group.length ? drag.group : (drag.obj ? [drag.obj] : []);
    for (const o of targets) {
        if (o instanceof Core) continue; // cannot delete core
        // disconnect ports
        if (o.getPorts) {
            for (const p of o.getPorts()) {
                if (p.isConnected) p.disconnect();
            }
        }
        const i = objects.indexOf(o);
        if (i >= 0) objects.splice(i, 1);
    }
    drag = null;
    canvas.style.cursor = 'default';
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
        if (!obj.getPorts) continue;
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


/** Union of port-connected group and all objects sharing overlapping glue. */
function getGlueCluster(start) {
    const group = new Set([start]);
    const queue = [start];
    while (queue.length) {
        const o = queue.shift();
        for (const g of objects) {
            if (!(g instanceof Glue)) continue;
            // Does this glue touch o?
            if (!g.overlapsObject(o) && g !== o) continue;
            // Add glue itself so dragging glue moves stuck objects
            if (!group.has(g)) {
                group.add(g);
                queue.push(g);
            }
            for (const other of objects) {
                if (other === g || other === o) continue;
                if (group.has(other)) continue;
                if (g.overlapsObject(other)) {
                    group.add(other);
                    queue.push(other);
                }
            }
        }
        // if o is glue, already handled
        if (o instanceof Glue) {
            for (const other of objects) {
                if (other === o || group.has(other)) continue;
                if (o.overlapsObject(other)) {
                    group.add(other);
                    queue.push(other);
                }
            }
        }
    }
    return group;
}

function getPhysicalGroup(start) {
    const group = new Set(getDirectConnectedGroup(start));
    // Expand through glue for every member
    let changed = true;
    while (changed) {
        changed = false;
        for (const o of [...group]) {
            for (const g of getGlueCluster(o)) {
                if (!group.has(g)) {
                    group.add(g);
                    changed = true;
                }
            }
            for (const d of getDirectConnectedGroup(o)) {
                if (!group.has(d)) {
                    group.add(d);
                    changed = true;
                }
            }
        }
    }
    // Glues with no ports — still include
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
    // Always include glue + direct port links as one rigid body
    const groupSet = new Set(getPhysicalGroup(start));

    if (withShift) {
        const seed = [...groupSet];
        for (const o of seed) {
            if (!o.getPorts) continue;
            for (const w of getWireConnectedGroup(o)) {
                groupSet.add(w);
            }
        }
        const seed2 = [...groupSet];
        for (const o of seed2) {
            for (const d of getPhysicalGroup(o)) {
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

/** After a drag ends: only try to connect free ports that belonged to the released item. */
function connectOverlappingPorts(candidatePorts) {
    if (!candidatePorts || candidatePorts.length === 0) return;
    // Prefer wire ends first so they snap onto component ports
    const free = candidatePorts.filter(p => p && !p.isConnected);
    free.sort((a, b) => {
        const aw = a.owner && a.owner.isWire ? 0 : 1;
        const bw = b.owner && b.owner.isWire ? 0 : 1;
        return aw - bw;
    });
    for (const port of free) {
        if (port.isConnected) continue;
        tryConnect(port, 6);
    }
}

/** Collect free ports owned by the just-released drag target. */
function portsFromDrag(d) {
    if (!d) return [];
    const out = [];
    const addOwnerPorts = (owner) => {
        if (!owner || !owner.getPorts) return;
        for (const p of owner.getPorts()) out.push(p);
    };
    if (d.kind === 'group' || d.kind === 'wire-group') {
        for (const o of (d.group || [])) addOwnerPorts(o);
    } else if (d.kind === 'port') {
        out.push(d.port);
    } else if (d.kind === 'joint') {
        if (d.portA) out.push(d.portA);
        if (d.portB) out.push(d.portB);
    } else if (d.kind === 'wire-translate') {
        addOwnerPorts(d.wire);
    }
    return out;
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
            for (const d of getPhysicalGroup(o)) {
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
    if (!obj.getPorts) return;
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
        if (o.noCollision) continue;
        for (const other of objects) {
            if (groupSet.has(other)) continue;
            if (other.noCollision) continue;
            if (other instanceof Door && other.open) continue;
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
    for (const o of objects) {
        o.updatePorts();
        orientObjectPorts(o);
    }
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


canvas.addEventListener('dblclick', (e) => {
    if (onTitleScreen) return;
    const pos = getMousePos(e);
    const obj = findObjectAt(pos.x, pos.y);
    if (obj instanceof BitNumber) {
        openNumberEdit(obj);
    } else if (obj instanceof SignalDelay || obj instanceof SignalSustain) {
        openDelayEdit(obj);
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (onTitleScreen) return;
    if (editingNumber) closeNumberEdit(true);
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
        // Glue rim resize
        if (obj instanceof Glue) {
            const dEdge = Math.abs(dist(pos.x, pos.y, obj.centerX, obj.centerY) - obj.radius);
            if (dEdge <= 10) {
                drag = {
                    kind: 'glue-resize',
                    glue: obj,
                    startR: obj.radius
                };
                canvas.style.cursor = 'nwse-resize';
                return;
            }
        }
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
    hoveredGlue = under instanceof Glue ? under : null;

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
        if (hoveredGlue) {
            const dEdge = Math.abs(dist(pos.x, pos.y, hoveredGlue.centerX, hoveredGlue.centerY) - hoveredGlue.radius);
            canvas.style.cursor = dEdge <= 10 ? 'nwse-resize' : 'grab';
        } else if (hoveredLever || hoveredButton || hoveredJoint) {
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
    } else if (drag.kind === 'glue-resize') {
        const g = drag.glue;
        const r = dist(pos.x, pos.y, g.centerX, g.centerY);
        g.setRadius(r);
    }
});

window.addEventListener('mouseup', () => {
    if (!drag) return;

    if (drag.kind === 'group') {
        for (const o of (drag.group || [])) {
            if (typeof o.snapRotation === 'function') o.snapRotation();
        }

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

    const releasedPorts = portsFromDrag(drag);
    syncAllPorts();
    connectOverlappingPorts(releasedPorts);
    validateObjObjConnections();

    drag = null;
    canvas.style.cursor = 'default';
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true;

    // Rotate while dragging group of objects
    if (drag && drag.kind === 'group' && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
        const delta = (e.key === 'q' || e.key === 'Q') ? -15 : 15;
        const group = drag.group || (drag.obj ? [drag.obj] : []);
        for (const o of group) {
            if (typeof o.rotateBy === 'function') o.rotateBy(delta);
        }
        e.preventDefault();
        return;
    }

    // Delete dragged objects (not Core)
    if (drag && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        deleteDraggedObject();
        return;
    }

    if (e.key === 'e' || e.key === 'E') {
        eHeld = true;
        if (drag) return; // rotation handled above
        if (hoveredLever) {
            hoveredLever.toggle();
        } else if (hoveredGlue) {
            hoveredGlue.active = !hoveredGlue.active;
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
    if (drag && drag.kind === 'group' && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
        for (const o of (drag.group || [])) {
            if (typeof o.snapRotation === 'function') o.snapRotation();
        }
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

    if (!onTitleScreen && !gameOver && !gameWon && !pausedForPick) {
        for (const o of objects) {
            if (o instanceof Button) o.updateButton(now, hoveredButton === o, eHeld);
            if (o instanceof Lever) o.updateAnimation(dt);
        }

        for (const o of objects) {
            if (typeof o.physicsTick === 'function') o.physicsTick(dt);
        }

        // Arrows & enemies (cap for performance)
        if (arrows.length > 150) arrows.splice(0, arrows.length - 150);
        for (let i = 0; i < arrows.length; i++) arrows[i].tick(dt);
        let aw = 0;
        for (let i = 0; i < arrows.length; i++) {
            if (!arrows[i].dead) arrows[aw++] = arrows[i];
        }
        arrows.length = aw;

        for (let i = 0; i < enemies.length; i++) enemies[i].tick(dt);
        let ew = 0;
        for (let i = 0; i < enemies.length; i++) {
            if (!enemies[i].dead) enemies[ew++] = enemies[i];
        }
        enemies.length = ew;

        for (let i = 0; i < explosions.length; i++) {
            const ex = explosions[i];
            ex.age += dt;
            ex.r = ex.maxR * Math.min(1, ex.age / ex.life);
        }
        let xw = 0;
        for (let i = 0; i < explosions.length; i++) {
            if (explosions[i].age < explosions[i].life) explosions[xw++] = explosions[i];
        }
        explosions.length = xw;

        for (let i = 0; i < floatingTexts.length; i++) {
            const f = floatingTexts[i];
            f.age += dt;
            f.y += f.vy * dt;
            f.vy += 20 * dt;
        }
        let fw = 0;
        for (let i = 0; i < floatingTexts.length; i++) {
            if (floatingTexts[i].age < floatingTexts[i].life) floatingTexts[fw++] = floatingTexts[i];
        }
        floatingTexts.length = fw;

        for (let i = 0; i < hitSparks.length; i++) hitSparks[i].age += dt;
        let sw = 0;
        for (let i = 0; i < hitSparks.length; i++) {
            if (hitSparks[i].age < hitSparks[i].life) hitSparks[sw++] = hitSparks[i];
        }
        hitSparks.length = sw;

        for (let i = 0; i < muzzleFlashes.length; i++) muzzleFlashes[i].age += dt;
        let mw = 0;
        for (let i = 0; i < muzzleFlashes.length; i++) {
            if (muzzleFlashes[i].age < muzzleFlashes[i].life) muzzleFlashes[mw++] = muzzleFlashes[i];
        }
        muzzleFlashes.length = mw;

        syncAllPorts();
        validateObjObjConnections();
        evaluateCircuit();
        for (const o of objects) {
            if (o.isSequential && typeof o.sequentialTick === 'function') o.sequentialTick(dt);
        }
        evaluateCircuit();

        tickWaves(dt);
    } else if (!onTitleScreen) {
        // still draw / allow limited updates during pick
        syncAllPorts();
        evaluateCircuit();
    }

    // Draw
    for (const w of wires) w.draw(ctx);
    for (const o of objects) {
        if (o instanceof Glue) {
            o.draw(ctx);
            continue;
        }
        if (o.angle) {
            ctx.save();
            const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
            ctx.translate(cx, cy);
            ctx.rotate(o.angle * Math.PI / 180);
            ctx.translate(-cx, -cy);
            o.draw(ctx);
            ctx.restore();
        } else {
            o.draw(ctx);
        }
    }
    for (const a of arrows) a.draw(ctx);
    for (const e of enemies) e.draw(ctx);
    for (const ex of explosions) {
        const alpha = 1 - ex.age / ex.life;
        ctx.strokeStyle = 'rgba(251, 146, 60,' + (alpha * 0.9) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(254, 215, 170,' + (alpha * 0.25) + ')';
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, ex.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        // radial lines
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + ex.age * 2;
            ctx.strokeStyle = 'rgba(255, 255, 255,' + (alpha * 0.5) + ')';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(ex.x + Math.cos(a) * ex.r * 0.2, ex.y + Math.sin(a) * ex.r * 0.2);
            ctx.lineTo(ex.x + Math.cos(a) * ex.r, ex.y + Math.sin(a) * ex.r);
            ctx.stroke();
        }
        // fewer particle updates — use age-based
        const nSpark = 6;
        for (let i = 0; i < nSpark; i++) {
            const a = (i / nSpark) * Math.PI * 2 + ex.age * 3;
            const rr = ex.r * (0.4 + 0.6 * (ex.age / ex.life));
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = '#fdba74';
            ctx.beginPath();
            ctx.arc(ex.x + Math.cos(a) * rr, ex.y + Math.sin(a) * rr, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // Muzzle flashes
    for (const m of muzzleFlashes) {
        const t = 1 - m.age / m.life;
        const rad = m.angle * Math.PI / 180;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(rad);
        ctx.globalAlpha = t;
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(14 * t, -6);
        ctx.lineTo(18 * t, 0);
        ctx.lineTo(14 * t, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(0, 0, 4 * t, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Hit sparks
    for (const s of hitSparks) {
        const t = 1 - s.age / s.life;
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = t;
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + s.age * 10;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x + Math.cos(a) * 10 * t, s.y + Math.sin(a) * 10 * t);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;

    // Floating damage / heal text (on top)
    for (const f of floatingTexts) {
        const t = 1 - f.age / f.life;
        ctx.globalAlpha = Math.min(1, t * 1.4);
        drawOutlinedText(ctx, f.text, f.x, f.y, f.color);
    }
    ctx.globalAlpha = 1;

    for (const p of allPorts()) p.draw(ctx);

    if (!drag && !onTitleScreen && !gameOver && !gameWon) {
        if (hoveredLever) {
            drawTooltip(ctx, hoveredLever.x + hoveredLever.w / 2, hoveredLever.y, 'E to toggle');
        } else if (hoveredGlue) {
            drawTooltip(ctx, hoveredGlue.centerX, hoveredGlue.y, 'E to detach/reattach · drag rim to resize');
        } else if (hoveredButton) {
            drawTooltip(ctx, hoveredButton.x + hoveredButton.w / 2, hoveredButton.y, 'Hold E to press');
        } else if (hoveredJoint) {
            drawTooltip(ctx, hoveredJoint.x, hoveredJoint.y, 'E to disconnect');
        }
    }

    requestAnimationFrame(loop);
}

resize();
showTitleScreen();
requestAnimationFrame(loop);
