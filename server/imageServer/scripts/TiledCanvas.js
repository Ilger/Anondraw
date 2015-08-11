function decodeDrawing (drawing) {
    if (drawing[4].length == 6)
        drawing[4] = "#" + drawing[4]

    var newDrawing = {
        type: this.drawingTypes[drawing[0]],
        x: drawing[1],
        y: drawing[2],
        size: drawing[3],
        color: drawing[4]
    };

    if (drawing[5]) newDrawing.x1 = drawing[5];
    if (drawing[6]) newDrawing.y1 = drawing[6];

    return newDrawing;
}

function TiledCanvas (canvas, settings) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d');

    this.leftTopX = 0;
    this.leftTopY = 0;
    this.zoom = 1; // 2 = two times zoomed in

    this.affecting = [[0, 0], [0, 0]];
    this.chunks = {};
    // this.chunks[chunkX][chunkY] is a context or 'empty'

    this.settings = this.normalizeDefaults(settings, this.defaultSettings);
    this.contextQueue = [];
    this.context = this.createContext();
}

TiledCanvas.prototype.defaultSettings = {
    chunkSize: 256
};

TiledCanvas.prototype.drawDrawings = function drawDrawings (drawings, callback) {
    var todo = drawings.length;

    function lowerAndCheck () {
        todo--;
        if (todo == 0) callback();
    }

    for (var k = 0; k < drawings.length; k++) {
        this.drawDrawing(decodeDrawing(drawings[k]), lowerAndCheck);
    }

    if (todo == 0) callback();
};

TiledCanvas.prototype.drawDrawing = function drawDrawing (decodedDrawing, callback) {
    this.drawFunctions[decodedDrawing.type](this.context, decodedDrawing, this, callback);
};

TiledCanvas.prototype.drawFunctions = {
    brush: function (context, drawing, tiledCanvas, callback) {
        context.beginPath();
        context.arc(drawing.x, drawing.y, drawing.size, 0, 2 * Math.PI, true);
        context.fillStyle = drawing.color;
        context.fill();

        if (tiledCanvas) {
            tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x, drawing.y, drawing.size);
            tiledCanvas.executeNoRedraw(callback);
        }
    },
    block: function (context, drawing, tiledCanvas, callback) {
        context.fillStyle = drawing.color;
        context.fillRect(drawing.x, drawing.y, drawing.size, drawing.size);

        if (tiledCanvas) {
            tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x, drawing.y, drawing.size);
            tiledCanvas.executeNoRedraw(callback);
        }
    },
    line: function (context, drawing, tiledCanvas, callback) {
        var todo = 3;

        function lowerAndCheck () {
            todo--;
            if (todo == 0) callback();
        }

        this.brush(context, {
            x: drawing.x,
            y: drawing.y,
            color: drawing.color,
            size: drawing.size / 2
        }, tiledCanvas, lowerAndCheck);

        context.beginPath();

        context.moveTo(drawing.x, drawing.y);
        context.lineTo(drawing.x1, drawing.y1);
        
        context.strokeStyle = drawing.color;
        context.lineWidth = drawing.size;

        context.stroke();
        
        if (tiledCanvas) {
            tiledCanvas.drawingRegion(drawing.x, drawing.y, drawing.x1, drawing.y1, drawing.size);
            tiledCanvas.executeNoRedraw(lowerAndCheck);
        }

        this.brush(context, {
            x: drawing.x1,
            y: drawing.y1,
            color: drawing.color,
            size: drawing.size / 2
        }, tiledCanvas, lowerAndCheck);
    }
};

TiledCanvas.prototype.cloneObject = function (obj) {
	var clone = {};
	for (var k in obj) {
		if (typeof obj[k] === "object" && !(obj[k] instanceof Array)) {
			clone[k] = this.cloneObject(obj[k]);
		} else {
			clone[k] = obj[k]
		}
	}
	return clone;
};

TiledCanvas.prototype.normalizeDefaults = function normalizeDefaults (target, defaults) {
	target = target || {};
	var normalized = this.cloneObject(target);
	for (var k in defaults) {
		if (typeof defaults[k] === "object" && !(defaults[k] instanceof Array)) {
			normalized[k] = this.normalizeDefaults(target[k] || {}, defaults[k]);
		} else {
			normalized[k] = target[k] || defaults[k];
		}
	}
	return normalized;
};


TiledCanvas.prototype.redraw = function redraw (noclear) {
    if (!noclear) this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    var startChunkX = Math.floor(this.leftTopX / this.settings.chunkSize),
        endChunkX   = Math.ceil((this.leftTopX + this.canvas.width / this.zoom) / this.settings.chunkSize),
        startChunkY = Math.floor(this.leftTopY / this.settings.chunkSize),
        endChunkY   = Math.ceil((this.leftTopY + this.canvas.height / this.zoom) / this.settings.chunkSize);
    
    for (var chunkX = startChunkX; chunkX < endChunkX; chunkX++) {
        for (var chunkY = startChunkY; chunkY < endChunkY; chunkY++) {
            this.drawChunk(chunkX, chunkY);
        }
    }
};

TiledCanvas.prototype.drawChunk = function drawChunk (chunkX, chunkY) {
    if (this.chunks[chunkX] && this.chunks[chunkX][chunkY] && this.chunks[chunkX][chunkY] !== "empty") {
        this.ctx.drawImage(this.chunks[chunkX][chunkY].canvas, ((chunkX * this.settings.chunkSize) - this.leftTopX) * this.zoom, ((chunkY * this.settings.chunkSize) - this.leftTopY) * this.zoom, this.settings.chunkSize * this.zoom, this.settings.chunkSize * this.zoom);
    } else if(typeof this.requestUserChunk == "function" && (!this.chunks[chunkX] || this.chunks[chunkX][chunkY] !== "empty")) {
        this.requestChunk(chunkX, chunkY);
    }
};

TiledCanvas.prototype.goto = function goto (x, y) {
    this.leftTopX = x;
    this.leftTopY = y;
    this.redraw();
};

TiledCanvas.prototype.relativeZoom = function relativeZoom (zoom) {
    this.zoom *= zoom;
    this.redraw();
};

TiledCanvas.prototype.absoluteZoom = function absoluteZoom (zoom) {
    this.zoom = zoom;
    this.redraw();
};

TiledCanvas.prototype.execute = function execute (callback) {
    this.executeNoRedraw(callback);
    this.redraw();
};

TiledCanvas.prototype.executeNoRedraw = function executeNoRedraw (callback) {
    var todo = 0;
    callback = callback || function () {};

    function lowerAndCheck () {
        todo--;
        if (todo == 0) callback();
    }

    // These are split into 2 main loops to ensure callback only gets called once
    for (var chunkX = this.affecting[0][0]; chunkX < this.affecting[1][0]; chunkX++) {
        for (var chunkY = this.affecting[0][1]; chunkY < this.affecting[1][1]; chunkY++) {
            todo++;
        }
    }

    for (var chunkX = this.affecting[0][0]; chunkX < this.affecting[1][0]; chunkX++) {
        for (var chunkY = this.affecting[0][1]; chunkY < this.affecting[1][1]; chunkY++) {
            this.executeChunk(chunkX, chunkY, this.contextQueue, lowerAndCheck);
        }
    }

    this.contextQueue = [];
    if (todo == 0) callback();
};

TiledCanvas.prototype.clearAll = function clearAll () {
    this.contextQueue = [];
    for (var chunkX in this.chunks) {
        this.clearChunkRow(chunkX);
    }
};

TiledCanvas.prototype.clearChunkRow = function clearChunkRow (chunkX) {
    for (var chunkY in this.chunks[chunkX]) {
        this.clearChunk(chunkX, chunkY);
    }
};

TiledCanvas.prototype.clearChunk = function clearChunk (chunkX, chunkY) {
    if (this.chunks[chunkX][chunkY] == "empty") return;
	this.chunks[chunkX][chunkY].clearRect(chunkX * this.settings.chunkSize, chunkY * this.settings.chunkSize, this.chunks[chunkX][chunkY].canvas.width, this.chunks[chunkX][chunkY].canvas.height);
};

TiledCanvas.prototype.requestChunk = function requestChunk (chunkX, chunkY, callback) {
    // Request a chunk and redraw once we got it
    if (typeof this.requestUserChunk !== "function") return;
    this.requestChunkCallbackList = this.requestChunkCallbackList || {};

    if (this.requestChunkCallbackList[chunkX] && this.requestChunkCallbackList[chunkX][chunkY]) {
        if (!callback) return;
        // This chunk has already been requested, add to the callback list
        this.requestChunkCallbackList[chunkX][chunkY].push(callback);
    } else {
        this.requestChunkCallbackList[chunkX] = this.requestChunkCallbackList[chunkX] || {};

        var queue = [];
        if (callback) queue.push(callback);
        this.requestChunkCallbackList[chunkX][chunkY] = queue;

        this.requestUserChunk(chunkX, chunkY, function (image) {
            // For responsiveness make sure the callback doesnt happen in the same event frame
            setTimeout(this.setUserChunk.bind(this, chunkX, chunkY, image));
        }.bind(this));
    }
};

TiledCanvas.prototype.setUserChunk = function setUserChunk (chunkX, chunkY, image) {
    // Don't set the user chunk twice
    if (this.chunks[chunkX] && this.chunks[chunkX][chunkY]) return;

    // If the image is falsy and there is no queue then this chunk is transparent
    // for performance reasons empty chunks should not allocate memory
    if (!image && (!this.requestChunkCallbackList[chunkX] || this.requestChunkCallbackList[chunkX][chunkY].lenth == 0)) {
        this.chunks[chunkX] = this.chunks[chunkX] || {};
        this.chunks[chunkX][chunkY] = "empty";
        return;
    }

    // Draw the chunk
    this.chunks[chunkX] = this.chunks[chunkX] || {};
    this.chunks[chunkX][chunkY] =  this.newCtx(this.settings.chunkSize, this.settings.chunkSize, -chunkX * this.settings.chunkSize, -chunkY * this.settings.chunkSize);

    if (image) this.chunks[chunkX][chunkY].drawImage(image, chunkX * this.settings.chunkSize, chunkY * this.settings.chunkSize);

    // Run all callbacks
    var callbackList = this.requestChunkCallbackList[chunkX][chunkY];
    for (var k = 0; k < callbackList.length; k++) {
        callbackList[k]();
    }

    // Do a full redraw of the tiled canvas
    this.redraw();

    delete this.requestChunkCallbackList[chunkX][chunkY];
};

TiledCanvas.prototype.copyArray = function copyArray (arr) {
    var temp = [];
    for (var k = 0; k < arr.length; k++) {
        temp[k] = arr[k];
    }
    return temp;
};

TiledCanvas.prototype.executeChunk = function executeChunk (chunkX, chunkY, queue, callback) {
    callback = callback || function () {};
    queue = queue || this.contextQueue;

    // Executes the current queue on a chunk
    // If queue is set execute that queue instead
    this.chunks[chunkX] = this.chunks[chunkX] || [];
 
    if (!this.chunks[chunkX][chunkY] || this.chunks[chunkX][chunkY] == "empty") {
        // This chunk has never been painted to before
        // We first have to ask what this chunk looks like
        // Remember the Queue untill we got the chunk
        // if we already remembered a queue then add this queue to it
        // Only do this when we actually want to use userdefined chunks
        if (typeof this.requestUserChunk == "function" && this.chunks[chunkX][chunkY] !== "empty") {
            this.requestChunk(chunkX, chunkY, function (queue) {
                this.executeChunk(chunkX, chunkY, queue, callback);
            }.bind(this, this.copyArray(queue)));
            return;
        } else {
            this.chunks[chunkX][chunkY] =  this.newCtx(this.settings.chunkSize, this.settings.chunkSize, -chunkX * this.settings.chunkSize, -chunkY * this.settings.chunkSize);
        }
    }

    var ctx = this.chunks[chunkX][chunkY];

    for (var queuekey = 0; queuekey < queue.length; queuekey++) {
        if (typeof ctx[queue[queuekey][0]] === 'function') {
            this.executeQueueOnChunk(ctx, queue[queuekey], callback);
        } else {
            ctx[queue[queuekey][0]] = queue[queuekey][1];
        }
    }
};

TiledCanvas.prototype.executeQueueOnChunk = function executeQueueOnChunk (ctx, args, callback) {
    ctx[args[0]].apply(ctx, Array.prototype.slice.call(args, 1));
    callback();
};

TiledCanvas.prototype.drawingRegion = function (startX, startY, endX, endY, border) {
    border = border || 0;
    this.affecting[0][0] = Math.floor((Math.min(startX, endX) - border) / this.settings.chunkSize);
    this.affecting[0][1] = Math.floor((Math.min(startY, endY) - border) / this.settings.chunkSize);
    this.affecting[1][0] = Math.ceil((Math.max(endX, startX) + border) / this.settings.chunkSize);
    this.affecting[1][1] = Math.ceil((Math.max(endY, startY) + border) / this.settings.chunkSize);
};

TiledCanvas.prototype.newCtx = function newCtx (width, height, translateX, translateY) {
    var ctx = document.createElement('canvas').getContext('2d');
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.translate(translateX, translateY);
    return ctx;
};

TiledCanvas.prototype.createContext = function createContext () {
    var context = {};
    var ctx = document.createElement('canvas').getContext('2d');
    for (var key in ctx) {
        if (typeof ctx[key] === 'function') {
            context[key] = function (func) {
                this.contextQueue.push(arguments);
            }.bind(this, key);
        } else if (typeof ctx[key] !== 'object') {
            context.__defineGetter__(key, function (key) {
                var ctx = this.newCtx();
                for (var queuekey = 0; queuekey < this.contextQueue.length; queuekey++) {
                    if (typeof ctx[args[0]] === 'function') {
                        ctx[args[0]].apply(ctx, args.slice(1));
                    } else {
                        ctx[args[0]] = args[1];
                    }
                }
                return ctx[key];
            }.bind(this, key));

            context.__defineSetter__(key, function (key, value) {
                this.contextQueue.push(arguments);
            }.bind(this, key));
        }
    }
    return context;
};

// This function can be used to save the chunks
// 
// saveFunction will be called for every chunk with (canvas, x, y, callback)
// you have to call the callback after the chunk is saved
// 
// callback will be called after all chunks have been saved
TiledCanvas.prototype.save = function save (saveFunction, callback) {
    var todo = 0;

    function lowerAndCheck () {
        todo--;
        if (todo == 0) callback();
    }

    // Two seperate loops to ensure callback gets called only once
    for (var x in this.chunks) {
        for (var y in this.chunks[x]) {
            todo++;
        }
    }
    
    for (var x in this.chunks) {
        for (var y in this.chunks[x]) {
            this.chunks[x][y].toBuffer(function (x, y, err, data) {
                if (err) {
                    console.log("toBuffer error", err);
                    return;
                }

                saveFunction(data, x, y, lowerAndCheck);
            }.bind(this, x, y));
        }
    }

    if (todo == 0) callback();
};

module.exports = TiledCanvas;