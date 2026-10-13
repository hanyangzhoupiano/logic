import { Port } from './port.js';
import {
    drawBody, drawLabel, BODY_FILL, BUTTON_MIN_MS, PORT_RADIUS, clamp
} from './utils.js';

// ---------- Obj (passthrough block) ----------

export class Obj {
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
        if (this.inputPort) this.inputPort.draw(ctx);
        if (this.outputPort) this.outputPort.draw(ctx);
    }

    contains(px, py) {
        return px >= this.x && px <= this.x + this.w &&
               py >= this.y && py <= this.y + this.h;
    }

    getPorts() {
        const ports = [];
        if (this.inputPort) ports.push(this.inputPort);
        if (this.inputA) ports.push(this.inputA);
        if (this.inputB) ports.push(this.inputB);
        if (this.outputPort) ports.push(this.outputPort);
        return ports;
    }

    get isSource() {
        return false;
    }
}

// ---------- Dual-input gate base ----------

export class Gate2 extends Obj {
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
        if (this.inputA) this.inputA.draw(ctx);
        if (this.inputB) this.inputB.draw(ctx);
        if (this.outputPort) this.outputPort.draw(ctx);
    }
}

export class AND extends Gate2 {
    constructor(x, y) { super(x, y, 'AND', (a, b) => a && b); }
}
export class OR extends Gate2 {
    constructor(x, y) { super(x, y, 'OR', (a, b) => a || b); }
}
export class XOR extends Gate2 {
    constructor(x, y) { super(x, y, 'XOR', (a, b) => a !== b); }
}
export class NAND extends Gate2 {
    constructor(x, y) { super(x, y, 'NAND', (a, b) => !(a && b)); }
}
export class NOR extends Gate2 {
    constructor(x, y) { super(x, y, 'NOR', (a, b) => !(a || b)); }
}
export class XNOR extends Gate2 {
    constructor(x, y) { super(x, y, 'XNOR', (a, b) => a === b); }
}

// ---------- NOT ----------

export class NOT extends Obj {
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
        if (this.inputPort) this.inputPort.draw(ctx);
        if (this.outputPort) this.outputPort.draw(ctx);
    }
}

// ---------- Lever ----------

export class Lever extends Obj {
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

        if (this.outputPort) this.outputPort.draw(ctx);
    }
}

// ---------- Battery (always on) ----------

export class Battery extends Obj {
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
        if (this.outputPort) this.outputPort.draw(ctx);
    }
}

// ---------- Button ----------

export class Button extends Obj {
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
        if (this.outputPort) this.outputPort.draw(ctx);
    }
}

// ---------- Lamp (input only) ----------

export class Lamp extends Obj {
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

        if (this.inputPort) this.inputPort.draw(ctx);
    }
}
