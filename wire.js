import { Port } from './port.js';
import {
    dist, MAX_WIRE_LENGTH, PORT_RADIUS, WIRE_WIDTH,
    raycastObjects, snapAngle, snapGrid, pointToSegment
} from './utils.js';
import { Obj } from './components.js';

export class Wire {
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
        this.inputPort.draw(ctx);
        this.outputPort.draw(ctx);
    }

    getPorts() {
        return [this.inputPort, this.outputPort];
    }
}
