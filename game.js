class Blinker {
    constructor(ctx, o, hilite) {
        let count = 0;
        this.timer = setInterval(() => {
                if (this._paused) return;
                window.blinker = true;
                o.display(ctx, count++ % 2 ? hilite : null);
                window.blinker = false;
            }, 500
        );

        this.stop = () => {
            clearInterval(this.timer);
            o.display(ctx);
        };
    }

    set paused(value) {
        this._paused = !!value;
    }
}

class GamePage {
    constructor(model) {
        this.id = 'game';
        this.model = model;
    }

    init() {
        this.name = document.getElementById('gameName');
        this.back = document.getElementById('gameBack');
        this.movesPanel = document.getElementById(('gamePositions'));
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = new CtxWrapper(this.canvas.getContext('2d'), 6);
        this.baseCtx = new CtxWrapper(document.getElementById('gameBaseCanvas').getContext('2d'), 6);

        window.addEventListener('keyup', e => this.onKeyUp(e));
        this.canvas.addEventListener('click', e => this.onMouseClick(e));
        this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
        this.back.addEventListener('click', () => this.onBack());
        this.position = null;
        this.isFinished = false;
        this.hoverColors = ['#555500', '#888822', '#aaaa44', '#dddd66'];
    }

    onBack() {
        this.model.routeTo('front');
    }

    onMouseMove(e) {
        if (!this.isActive || this.animating) {
            return;
        }
        this.highlightHoveredMoves(this.position.maze.objectAt(e.offsetX, e.offsetY, 'game', true));
    }

    highlightHoveredMoves(o) {
        let movesById;
        if (o && o.isMoveSet) {
            movesById = o.moves.reduce((map, move) => (map[move.id] = move, map), {});
        } else {
            movesById = Object.values(this.position.maze.moves)
                .filter(move => move.beginGate === o || move.endGate === o)
                .reduce((map, move) => (map[move.id] = move, map), {});
        }
        if (Object.keys(movesById).length === 0) {
            if (this.showingHoveredPaths) {
                this.showingHoveredPaths = null;
                this.showPosition();
            }
            return;
        }

        const sortedMoveIds = Object.keys(movesById).sort();
        const newMoveIds = sortedMoveIds.join(',');
        if (this.showingHoveredPaths === newMoveIds) return;

        if (this.blinker) this.blinker.stop();
        this.showingHoveredPaths = newMoveIds;

        const moveInfos = sortedMoveIds
            .map(id => movesById[id])
            .map((move, i) => ({move, hover: (i < 4 ? i : 3)}))
            .reduce((map, info) => (map[info.move.id] = info, map), {});

        // highlight the hovered paths
        this.showPosition();
        this.blinker.paused = true;
        Object.values(moveInfos).forEach(({move, hover}) => {
            move.displayPathBetween(this.ctx, 'forward', this.hoverColors[hover]);
        });
        this.blinker.paused = false;

        // update move table
        let m = this.head;
        while (m) {
            const element = document.getElementById('move' + m.id);
            const info = moveInfos[m.id];
            removeClass(element, '-hovered0');
            removeClass(element, '-hovered1');
            removeClass(element, '-hovered2');
            removeClass(element, '-hovered3');
            if (info) {
                const hoverClass = '-hovered' + info.hover;
                addClass(element, hoverClass);
                element.oldHoverClass = hoverClass;
            }
            m = m.next;
        }
    }


    onKeyUp(e) {
        if (!this.isActive || this.animating) {
            return;
        }
        switch (e.keyCode) {
            case 8: // BACKSPACE
                if (!this.isFinished) {
                    this.makeMove(this.position.beginGate);
                }
                break;
            case 38: // UP
                if (this.position.next) {
                    this.position = this.position.next;
                    this.transitionPositions(!this.position.previous.endGate.isExternal ? 'out' : 'in', this.position.previous, this.position, 'forward');
                }
                else if (this.isFinished) {
                    this.position.tracePath(this.ctx, 'forward', 'green', 'gold');
                }
                break;
            case 40: // DOWN
                if (this.position.previous) {
                    this.position = this.position.previous;
                    this.transitionPositions(!this.position.next.beginGate.isExternal ? 'out' : 'in', this.position.next, this.position, 'back');
                }
                else {
                    this.position.tracePath(this.ctx, 'back', 'green', 'gold');
                }
                break;
        }
    }

    onMouseClick(e) {
        if (!this.isActive || e.button !== 0 || this.isFinished || this.animating) return;
        const o = this.position.maze.objectAt(e.offsetX, e.offsetY, 'game');
        if (!o) {
            return;
        }
        if (this.position.beginGate === o || this.position.possibleGates.indexOf(o) !== -1) {
            this.makeMove(o);
        }
    }

    makeMove(gate) {
        const lastPosition = this.position;
        const result = this.position.makeMove(gate);
        this.position = result.position;
        if (result.type === 'noop') return;
        else if (result.type === 'finish') this.isFinished = true;
        // in, out, finish, remove
        const position = result.type === 'finish' ? this.position : this.position.previous;
        this.animating = true;
        if (this.blinker) this.blinker.stop();
        let promise = Promise.resolve();
        if (!result.type.startsWith('remove')) {
            promise = position.displayPathBetween(this.ctx, 'forward', 'gold', true);
        }
        promise.then(() => this.transitionPositions(result.type, lastPosition, this.position));
    }

    transitionPositions(type, fromPosition, toPosition, tracePath) {
        return Promise.resolve().then(() => {
            if (tracePath === 'forward' || tracePath === 'back' && fromPosition.endGate) return fromPosition.tracePath(this.ctx, tracePath, 'green', 'gold');
        }).then(() => {
            if (type !== 'finish') {
                this.clearCanvas(this.baseCtx);
                return this.zoom(type, fromPosition, toPosition);
            }
        }).then(() => {
            this.head.maze.display(this.baseCtx);
            if (type.startsWith('remove')) {
                toPosition.maze.removeMove(toPosition);
                this.showPosition(true);
                return toPosition.displayVanishingPathBetween(this.ctx, 'forward', 'gold')
                    .then(() => {
                        toPosition.endGate = null;
                    });
            }
        }).then(() => {
            this.animating = false;
            this.showPosition();
        });
    }

    zoom(type, fromPosition, toPosition) {
        const duration = 1000;
        const frames = 20;
        const operation = type.endsWith('in') ? 'zoomInFrame' : 'zoomOutFrame';
        return new Promise(accept => {
            let i = 1;
            this[operation](toPosition, fromPosition, i++, frames);
            const timer = setInterval(() => {
                this[operation](toPosition, fromPosition, i++, frames);
                if (i > frames) {
                    clearInterval(timer);
                    accept();
                }
            }, duration / frames);
        });
    }

    zoomInFrame(toPosition, fromPosition, i, frames) {
        this.clearCanvas(this.ctx);
        let mazeRatio = toPosition.maze.width / toPosition.maze.subMazeWidth;
        this.ctx.scale(mazeRatio, mazeRatio);
        let stepRatio = i / frames;
        this.ctx.translate(-toPosition.maze.parent.x * stepRatio, -toPosition.maze.parent.y * stepRatio);
        mazeRatio = toPosition.maze.subMazeWidth / toPosition.maze.width;
        let factor = 1 + (frames - i) / frames * (mazeRatio - 1);
        this.ctx.scale(factor, factor);
        fromPosition.maze.display(this.ctx);
        this.showPlayedPosition(fromPosition, true);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);

        stepRatio = (frames - i) / frames;
        this.ctx.translate(toPosition.maze.parent.x * stepRatio, toPosition.maze.parent.y * stepRatio);
        this.ctx.scale(factor, factor);
        this.ctx.fillStyle = '#AAA';
        this.ctx.fillRect(0, 0, toPosition.maze.width, toPosition.maze.width);
        toPosition.maze.display(this.ctx);
        this.showPossibleGates(toPosition);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    zoomOutFrame(toPosition, fromPosition, i, frames) {
        this.clearCanvas(this.ctx);
        let mazeRatio = toPosition.maze.width / toPosition.maze.subMazeWidth;
        this.ctx.scale(mazeRatio, mazeRatio);
        let stepRatio = (frames - i) / frames;
        this.ctx.translate(-fromPosition.maze.parent.x * stepRatio, -fromPosition.maze.parent.y * stepRatio);
        mazeRatio = toPosition.maze.subMazeWidth / toPosition.maze.width;
        let factor = 1 + i / frames * (mazeRatio - 1);
        this.ctx.scale(factor, factor);
        toPosition.maze.display(this.ctx);
        this.showPossibleGates(toPosition, true);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);

        stepRatio = i / frames;
        this.ctx.translate(fromPosition.maze.parent.x * stepRatio, fromPosition.maze.parent.y * stepRatio);
        this.ctx.scale(factor, factor);
        this.ctx.fillStyle = '#AAA';
        this.ctx.fillRect(0, 0, fromPosition.maze.width, fromPosition.maze.width);
        fromPosition.maze.display(this.ctx);
        this.showPlayedPosition(fromPosition);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    clearCanvas(ctx) {
        ctx.clearRect(0, 0, this.position.maze.width, this.position.maze.width);
    }

    showPosition(noBlinker) {
        this.clearCanvas(this.ctx);
        if (this.blinker) this.blinker.stop();
        if (!this.position.next && !this.isFinished) this.showPossibleGates(noBlinker);
        else this.showPlayedPosition(this.position);
        if (this.isFinished && !this.position.next) {
            if (this.position.maze.finish) this.position.maze.finish.display(this.ctx, 'green');
            else this.position.endGate.display(this.ctx, 'green');
        }
        this.refreshMoves();
        addClass(document.getElementById('move' + this.position.id), '-active');
    }

    showPossibleGates(noBlinker) {
        this.position.beginGate.display(this.ctx, 'orange');
        this.position.possibleGates
            .filter(gate => {
                if (this.position.maze.level > 0) {
                    if (gate.parent.isEndPoint) return false;
                }
                else if (this.position.maze.finish) {
                    if (!gate.isExternal) return false;
                }
                return true;
            })
            .forEach(gate => gate.display(this.ctx, 'gold'));
        Object.keys(this.position.maze.moves)
            .map(moveId => this.position.maze.moves[moveId])
            .forEach(position => {
                position.displayPathBetween(this.ctx, 'forward', 'orange');
            });
        if (!noBlinker) this.blinker = new Blinker(this.ctx, this.position.beginGate, 'orange');
    }

    showPlayedPosition(position) {
        position.beginGate.display(this.ctx, 'orange');
        if (position.endGate) position.endGate.display(this.ctx, 'gold');
        Object.keys(position.maze.moves)
        //.filter(moveId => moveId <= position.id)
            .map(moveId => position.maze.moves[moveId])
            .forEach(pos => {
                const color = position.beginGate.id === pos.beginGate.id && position.endGate.id === pos.endGate.id ? 'gold' : 'orange';
                pos.displayPathBetween(this.ctx, 'forward', color);
            });
    }

    refreshMoves() {
        this.movesPanel.innerHTML = '';
        let p = this.head;
        while (p) {
            const move = document.createElement('tr');
            move.appendChild(this.moveCell(p.id));
            move.appendChild(this.moveCell(p.maze.parent ? p.maze.parent.id : 'S'));
            move.appendChild(this.moveCell(p.maze.level));
            move.appendChild(this.moveCell(this.gateDisplayName(p.beginGate)));
            move.appendChild(this.moveCell(this.gateDisplayName(p.endGate)));
            move.id = 'move' + p.id;
            move.title = this.moveTitle(p.maze);
            if (this.movesPanel.firstChild) this.movesPanel.insertBefore(move, this.movesPanel.firstChild);
            else this.movesPanel.appendChild(move);
            p = p.next;
        }
    }

    gateDisplayName(gate) {
        if (!gate) return '';
        const parts = gate.id.split(':');
        return parts[0] === '_' ? parts[1] : gate.id;
    }

    moveCell(text) {
        const cell = document.createElement('td');
        cell.innerText = text;
        return cell;
    }


    moveTitle(maze) {
        let m = maze;
        const names = [];
        while (m) {
            if (m.parent) {
                names.push(m.parent.id);
                m = m.parent.parentMaze;
            }
            else {
                names.push('S');
                m = null;
            }
        }
        return names.join(' > ')
    }

    activate() {
        this.isFinished = false;
        this.name.innerText = this.model.currentMaze.name;
        const maze = new Maze(this.model, this.model.currentMaze);
        this.position = new GamePosition(maze, maze.startingPoint.startingGate());
        this.ctx.blockSize = maze.blockSize;
        this.baseCtx.blockSize = maze.blockSize;
        this.clearCanvas(this.baseCtx);
        maze.display(this.baseCtx);
        this.isActive = true;
        this.head = this.position;
        this.showPosition();
    }

    deactivate() {
        if (this.blinker) this.blinker.stop();
        this.isActive = false;
        this.clearCanvas(this.ctx);
        this.clearCanvas(this.baseCtx);
        this.position = null;
    }
}