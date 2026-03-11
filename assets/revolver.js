/*!
 * revolver.js — 3-D Ellipse Carousel
 * Vanilla JS · No dependencies · Shopify ready
 *
 * How it works (same math as CloudCarousel v1.0.5):
 *   Items are placed on an invisible ellipse with parametric equations:
 *     x = xCentre + (cos(angle) * xRadius - itemWidth/2) * scale
 *     y = yCentre + sin(angle) * yRadius * scale
 *     scale = ((sin(angle) + 1) * (1-minScale)/2) + minScale
 *   sin(angle) ≈ 1  → item is at the FRONT (largest, lowest z)
 *   sin(angle) ≈ -1 → item is at the BACK  (smallest, higher y)
 *
 * HTML expected inside the container:
 *   <a class="revolver-slide" href="#section-id">
 *     <img src="…" alt="" crossorigin="anonymous">
 *   </a>
 *
 * Usage:
 *   RevolverCarousel.init('#revolver-carousel');          // factory
 *   new RevolverCarousel('#revolver-carousel', options);  // class
 */
(function (global) {
  'use strict';

  /* ─── Utility ──────────────────────────────────────────────────────────── */

  function waitForImages(imgs, cb) {
    var total = imgs.length;
    if (!total) { cb(); return; }
    var done = 0;
    function tick() { if (++done >= total) cb(); }
    imgs.forEach(function (img) {
      if (img.complete && img.naturalWidth > 0) {
        tick();
      } else {
        img.addEventListener('load',  tick, { once: true });
        img.addEventListener('error', tick, { once: true });
      }
    });
  }

  /* ─── Constructor ──────────────────────────────────────────────────────── */

  function RevolverCarousel(el, opts) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) { console.warn('RevolverCarousel: element not found'); return; }

    this.el   = el;
    this.opts = Object.assign({
      minScale        : 0.45,   // scale of items at the very back
      speed           : 0.15,   // easing factor per frame (0-1)
      autoRotate      : 'left', // 'left' | 'right' | false
      autoRotateDelay : 2200,   // ms between auto-rotate steps
      reflHeight      : 60,     // reflection height in px at scale=1
      reflGap         : 4,      // gap between image bottom and reflection at scale=1
    }, opts || {});

    this.items        = [];
    this.rotation     = Math.PI / 2;  // item[0] starts at the front (sin = 1)
    this.destRotation = Math.PI / 2;
    this.frontIndex   = 0;
    this.raf          = null;
    this.timer        = null;
    this.hovering     = false;

    this._build();
  }

  /* ─── Prototype ────────────────────────────────────────────────────────── */

  RevolverCarousel.prototype = {

    /* Geometry — recalculated every frame so resize is free */
    _metrics: function () {
      var w = this.el.offsetWidth;
      var h = this.el.offsetHeight;
      var o = this.opts;
      return {
        xC : w / 2,
        yC : h * (o.yPosFactor    || 0.25),
        xR : w * (o.xRadiusFactor || 0.43),
        yR : h * (o.yRadiusFactor || 0.28),
      };
    },

    /* ── Build ─────────────────────────────────────────────────────────── */

    _build: function () {
      var self   = this;
      var slides = [].slice.call(self.el.querySelectorAll('.revolver-slide'));
      var imgs   = slides.map(function (s) { return s.querySelector('img'); }).filter(Boolean);

      /* Wait until every thumbnail is loaded so naturalWidth is available */
      waitForImages(imgs, function () {

        slides.forEach(function (slide, i) {
          var img = slide.querySelector('img');
          if (!img) return;

          /* Make slide absolutely positioned — JS will set left/top/w/h */
          slide.style.cssText += ';position:absolute;display:block;cursor:pointer;user-select:none;';

          /* Read CSS-normalized dimensions (height:12vw; width:auto from stylesheet)
             BEFORE overriding with width/height 100% */
          var ow = img.offsetWidth  || img.naturalWidth  || 300;
          var oh = img.offsetHeight || img.naturalHeight || 180;

          /* Now override so img fills the JS-controlled slide container */
          img.style.cssText += ';display:block;width:100%;height:100%;pointer-events:none;';

          /* Reflection canvas (sits below each slide, CSS-scaled every frame) */
          var canvas = document.createElement('canvas');
          canvas.style.cssText = 'position:absolute;pointer-events:none;';
          self.el.appendChild(canvas);

          var item = { el: slide, img: img, ow: ow, oh: oh, refl: canvas };
          self.items.push(item);
          self._drawReflection(item);

          /* ── Click handler: bring to front + fire onSelect callback ── */
          slide.addEventListener('click', function (e) {
            e.preventDefault();
            if (self._dragMoved > 6) return;   /* was a drag — ignore */
            self._bringToFront(i);
            if (typeof self.opts.onSelect === 'function') {
              setTimeout(function () { self.opts.onSelect(i, slide); }, 350);
            }
          });
        });

        /* ── Drag to rotate ──────────────────────────────────────── */
        self._dragActive  = false;
        self._dragMoved   = 0;
        self._dragStartX  = 0;
        self._dragStartRot = 0;

        function onDragStart(clientX) {
          self._dragActive   = true;
          self._dragMoved    = 0;
          self._dragStartX   = clientX;
          self._dragStartRot = self.destRotation;
          clearInterval(self.timer);
          self.el.style.cursor = 'grabbing';
        }
        function onDragMove(clientX) {
          if (!self._dragActive) return;
          var dx = clientX - self._dragStartX;
          self._dragMoved = Math.abs(dx);
          var w = self.el.offsetWidth || 600;
          self.destRotation = self._dragStartRot - dx * (Math.PI * 2 / w);
        }
        function onDragEnd() {
          if (!self._dragActive) return;
          self._dragActive = false;
          self.el.style.cursor = 'grab';
          if (self._dragMoved > 6) self._snapToNearest();
          if (!self.hovering) self._autoStart();
        }

        self.el.addEventListener('mousedown', function (e) {
          if (e.button !== 0) return;
          onDragStart(e.clientX);
        });
        self._onMouseMove = function (e) { onDragMove(e.clientX); };
        self._onMouseUp   = function ()  { onDragEnd(); };
        document.addEventListener('mousemove', self._onMouseMove);
        document.addEventListener('mouseup',   self._onMouseUp);

        self.el.addEventListener('touchstart', function (e) {
          onDragStart(e.touches[0].clientX);
        }, { passive: true });
        self._onTouchMove = function (e) { onDragMove(e.touches[0].clientX); };
        self._onTouchEnd  = function ()  { onDragEnd(); };
        document.addEventListener('touchmove', self._onTouchMove, { passive: true });
        document.addEventListener('touchend',  self._onTouchEnd);

        self.el.style.cursor = 'grab';

        /* Hover → pause auto-rotate, leave → resume */
        self.el.addEventListener('mouseenter', function () {
          self.hovering = true;
          clearInterval(self.timer);
        });
        self.el.addEventListener('mouseleave', function () {
          self.hovering = false;
          if (!self._dragActive) self._autoStart();
        });

        /* Keyboard: ← → arrow keys when focused */
        self.el.setAttribute('tabindex', '0');
        self.el.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft')  { self._step(-1); e.preventDefault(); }
          if (e.key === 'ArrowRight') { self._step( 1); e.preventDefault(); }
        });

        /* Start! */
        self._loopStart();
        self._autoStart();

        /* Fade in once everything is ready */
        self.el.style.transition = 'opacity .6s ease';
        requestAnimationFrame(function () { self.el.style.opacity = '1'; });
      });
    },

    /* ── Reflection ──────────────────────────────────────────────────── */

    _drawReflection: function (item) {
      var rh  = Math.min(this.opts.reflHeight, item.oh);
      var c   = item.refl;
      c.width  = item.ow;
      c.height = rh;

      var ctx = c.getContext('2d');
      var img = item.img;
      /* drawImage source coords must be in natural (intrinsic) pixel space */
      var nh  = img.naturalHeight || item.oh;
      var nw  = img.naturalWidth  || item.ow;
      var sy  = (item.oh - rh) * nh / item.oh;   /* bottom strip start, natural px */
      var sh  = rh              * nh / item.oh;   /* strip height, natural px */

      /* Draw the bottom portion of the image, flipped vertically */
      ctx.save();
      ctx.translate(0, rh);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, sy, nw, sh, 0, 0, item.ow, rh);
      ctx.restore();

      /* Erase pixels top→bottom with a gradient (opaque at top = visible reflection) */
      ctx.globalCompositeOperation = 'destination-out';
      var g = ctx.createLinearGradient(0, 0, 0, rh);
      g.addColorStop(0, 'rgba(255,255,255,0)');   /* top:    keep reflection */
      g.addColorStop(1, 'rgba(255,255,255,1)');   /* bottom: erase completely */
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, item.ow, rh);
    },

    /* ── Animation loop ──────────────────────────────────────────────── */

    _loopStart: function () {
      var self = this;
      function tick() {
        self._update();
        self.raf = requestAnimationFrame(tick);
      }
      self.raf = requestAnimationFrame(tick);
    },

    _update: function () {
      var m    = this._metrics();
      var opts = this.opts;
      var n    = this.items.length;
      if (!n) return;

      var smallRange = (1 - opts.minScale) * 0.5;   /* half-range of scale */
      var spacing    = (Math.PI * 2) / n;            /* angle between items */

      /* Ease rotation toward destination */
      var delta = this.destRotation - this.rotation;
      if (Math.abs(delta) < 0.0002) {
        this.rotation = this.destRotation;
      } else {
        this.rotation += delta * opts.speed;
      }

      for (var i = 0; i < n; i++) {
        var angle = this.rotation + i * spacing;
        var sv    = Math.sin(angle);               /* depth indicator */
        var cv    = Math.cos(angle);               /* horizontal position */
        var sc    = (sv + 1) * smallRange + opts.minScale;   /* 0.45 … 1.0 */

        var item  = this.items[i];
        var sw    = item.ow * sc;                  /* scaled width  */
        var sh    = item.oh * sc;                  /* scaled height */
        var z     = Math.floor(sc * 100) | 0;      /* z-index       */

        /* Position on ellipse — identical formula to CloudCarousel */
        var x = m.xC + (cv * m.xR - item.ow * 0.5) * sc;
        var y = m.yC + sv * m.yR * sc;

        var el = item.el;
        el.style.left   = x + 'px';
        el.style.top    = y + 'px';
        el.style.width  = sw + 'px';
        el.style.height = sh + 'px';
        el.style.zIndex = z;

        /* Reflection: only visible on front half (sv > 0), fades at sides */
        var rc = item.refl;
        rc.style.left    = x + 'px';
        rc.style.top     = (y + sh + opts.reflGap * sc) + 'px';
        rc.style.width   = sw + 'px';
        rc.style.height  = (opts.reflHeight * sc) + 'px';
        rc.style.zIndex  = z;
        rc.style.opacity = sv > 0 ? sv : 0;
      }
    },

    /* ── Rotation helpers ────────────────────────────────────────────── */

    /*
     * _step(d):
     *   d = +1 → next item comes to front  (carousel moves "left")
     *   d = -1 → prev item comes to front  (carousel moves "right")
     */
    _step: function (d) {
      var n = this.items.length;
      this.frontIndex   = ((this.frontIndex + d) % n + n) % n;
      this.destRotation -= d * (Math.PI * 2 / n);
    },

    _bringToFront: function (idx) {
      var n    = this.items.length;
      /* Find shortest angular distance */
      var diff = ((idx - this.frontIndex) % n + n) % n;
      if (diff > n / 2) diff -= n;
      if (diff === 0) return;

      clearInterval(this.timer);
      this._step(diff);
      if (!this.hovering) this._autoStart();
    },

    /* ── Snap to nearest item after drag ────────────────────────────── */

    _snapToNearest: function () {
      var n       = this.items.length;
      var spacing = Math.PI * 2 / n;
      var k       = Math.round((this.destRotation - Math.PI / 2) / spacing);
      this.destRotation = Math.PI / 2 + k * spacing;
      this.frontIndex   = ((-k % n) + n) % n;
    },

    /* ── Auto-rotate ─────────────────────────────────────────────────── */

    _autoStart: function () {
      clearInterval(this.timer);
      if (!this.opts.autoRotate) return;
      var self = this;
      var dir  = (this.opts.autoRotate === 'right') ? -1 : 1;
      this.timer = setInterval(function () { self._step(dir); }, self.opts.autoRotateDelay);
    },

    /* ── Public API ──────────────────────────────────────────────────── */

    next    : function () { this._step(1);  },
    prev    : function () { this._step(-1); },
    goTo    : function (i) { this._bringToFront(i); },
    destroy : function () {
      cancelAnimationFrame(this.raf);
      clearInterval(this.timer);
      if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
      if (this._onMouseUp)   document.removeEventListener('mouseup',   this._onMouseUp);
      if (this._onTouchMove) document.removeEventListener('touchmove', this._onTouchMove);
      if (this._onTouchEnd)  document.removeEventListener('touchend',  this._onTouchEnd);
    },
  };

  /* ─── Factory ──────────────────────────────────────────────────────────── */

  RevolverCarousel.init = function (sel, opts) {
    return new RevolverCarousel(sel, opts);
  };

  global.RevolverCarousel = RevolverCarousel;

}(typeof window !== 'undefined' ? window : this));
