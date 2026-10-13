import { dist, PORT_RADIUS, clamp } from './utils.js';

export class Port {
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
        if (this.powered && this.isConnected) return '#3b82f6';
        if (this.isConnected) return '#f5f5f5';
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
        ctx.strokeStyle = this.isConnected && !this.powered ? '#555' : '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
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
            // object ↔ object: move this.owner to align ports
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
