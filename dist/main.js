console.assert(typeof SunVoxLib !== "undefined");
console.assert(typeof sda_ctx !== "undefined");
console.assert(typeof sda_node !== "undefined");

let idx_latest_instance = 0;

const circle = (r, t, x=0, y=0) => [
  x + r * Math.cos(t * 2 * Math.PI - Math.PI / 2),
  y + r * Math.sin(t * 2 * Math.PI - Math.PI / 2),
];

// simple vector class
class Vec {
  constructor (x=0, y=0) {
    this.x=x; this.y=y;
  }
  add (v) {
    return new Vec(this.x+v.x, this.y+v.y);
  }
  rev () {
    return new Vec(-this.x, -this.y);
  }
  sub (v) {
    return this.add(v.rev());
  }
  mul_scalar (k) {
    return new Vec(this.x*k, this.y*k);
  }
  mul_scalar_2 (k,l) {
    return new Vec(this.x*k, this.y*l);
  }
  dist (v) {
    return Math.sqrt(Math.pow(this.x - v.x,2) + Math.pow(this.y - v.y,2));
  }
  size () {
    return Math.sqrt(Math.pow(this.x,2) + Math.pow(this.y,2));
  }
  unit () {
    return this.mul_scalar(1/this.size());
  }
  assert () {
    console.assert(!isNaN(this.x) && !isNaN(this.y));
  }
  static dist_st (v,w) {
    return v.dist(w);
  }
}

const load_img = async name_img => {
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      resolve(img)
    };
    img.onerror = (error) => {
      reject(error)
    };
    img.src = name_img;
  });
}

const init_sv = async svlib_promise => {
  const svlib = await svlib_promise;
  const version = svlib._sv_init(0, 44100, 2, 0);
  return [svlib, version];
}

const init = async (cv,file) => {
  // setting up the library
  const [svlib,ver] = await init_sv(SunVoxLib());
  if (ver < 0) {
    alert("Error while initializing SunVox Lib!");
    return null;
  }
  console.log(`SunVox lib version: ${(ver>>16)&255} ${(ver>>8)&255} ${ver&255}`);

  // preparing img
  const img_logo = await load_img("./sk0_logo.png");

  // preparing analyzer
  const anlz = sda_ctx.createAnalyser();
  anlz.fftSize = 2048;

  // loading SunVox project
  proj = await (async () => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    await new Promise(resolve => reader.onload = () => resolve());
    return new Uint8Array(reader.result);
  })();
  svlib._sv_open_slot(0);
  {
    const p = svlib.allocate(proj, "i8", svlib.ALLOC_NORMAL);
    console.assert(p !== 0);
    svlib._sv_load_from_memory(0, p, proj.byteLength);
    svlib._free(p);
  }
  const name_song = svlib.UTF8ToString(svlib._sv_get_song_name(0));

  // getting information of modules
  const len_modules = svlib._sv_get_number_of_modules(0);

  let modules = [...Array(len_modules).keys()].map((_,id) => {
    if (svlib._sv_get_module_flags(0,id) & 1 === 0) return null;
    const color = svlib._sv_get_module_color(0,id);
    const r = color & 255,
          g = (color>>8)  & 255,
          b = (color>>16) & 255;
    const pos = svlib._sv_get_module_xy(0,id);
    const x = (pos & 0xFFFF) & 0x8000 ? ((pos & 0xFFFF) - 0x10000) : (pos & 0xFFFF),
          y = ((pos>>16) & 0xFFFF) & 0x8000? (((pos>>16) & 0xFFFF) - 0x10000) : ((pos>>16) & 0xFFFF);

    const outputs = (() => {
      const num = (svlib._sv_get_module_flags(0,id) & (255 << 24)) >> 24;
      const p = svlib._sv_get_module_outputs(0,id);
      if (p === 0) return null;
      return svlib.HEAP32.subarray(p>>2, (p>>2)+num);
    })();

    if (outputs !== null) {
      for (let i=0; i<outputs.length; i++) {
        const jd = outputs[i];
        if (jd < 0) continue;
      }
    }
    return {
      p: new Vec(x,y),
      v: new Vec(),
      a: new Vec(),
      id, r, g, b,
    };
  });

  // adjust modules' positions
  {
    let upper  = Number.MIN_VALUE,
        bottom = Number.MAX_VALUE,
        left   = Number.MAX_VALUE,
        right  = Number.MIN_VALUE;
    let center = new Vec();

    modules.forEach(m => {
      upper  = Math.max(m.p.y, upper);
      bottom = Math.min(m.p.y, bottom);
      left   = Math.min(m.p.x, left);
      right  = Math.min(m.p.x, right);
      center = center.add(m.p);
    });
    center = center.mul_scalar(1 / len_modules);
    upper  -= center.y;
    bottom -= center.y;
    left   -= center.x;
    right  -= center.x;

    const x_max = Math.max(Math.abs(left), Math.abs(right));
    const y_max = Math.max(Math.abs(upper), Math.abs(bottom));
    modules.forEach(m => {
      m.p = m.p.sub(center).mul_scalar_2(1/x_max, 1/y_max);
    });
  }

  // add event listener that receives input from keyboard
  idx_latest_instance ++;
  const idx_instance = idx_latest_instance;
  document.addEventListener("keydown", e => {
    if (idx_instance !== idx_latest_instance) return;

    console.log(e, e.defaultPrevented, document.activeElement);
    if (e.defaultPrevented) return;

    console.log(e.code);
    switch(e.code) {
      case "Space":
        svlib._sv_end_of_song(0) ? svlib._sv_play(0) : svlib._sv_stop(0);
        e.preventDefault();
        break;
      case "Enter":
        svlib._sv_rewind(0, svlib._sv_get_current_line(0)+4);
        e.preventDefault();
        break;
    }
  });

  // start!
  svlib._sv_play_from_beginning(0);
  console.assert(sda_node !== null);
  sda_node.connect(anlz);

  loop_start(
    cv, anlz, anlz.frequencyBinCount, img_logo, modules, svlib,
    name_song,
    idx_instance
  );

  return svlib;
}

const loop_start = (
  cv, anlz, len_anlz, img_logo, modules, svlib,
  name_song,
  idx_instance
) => {
  // preparation
  const ctx = cv.getContext("2d", {willReadFrequently: true});

  const cv_rot = document.createElement("canvas");
  cv_rot.width = cv.width;
  cv_rot.height = cv.height;
  const ctx_rot = cv_rot.getContext("2d");

  const buf_time = new Float32Array(len_anlz);
  const buf_freq = new Float32Array(len_anlz);

  const no_signal = 1e-6;

  // functions for analyzer
  const calc_x = i => i===0 ? 0 : Math.log(i) * cv.width / Math.log(len_anlz);
  const calc_len_log = len_anlz => {
    let prev = 0;
    let xs = [];
    let idx = 0;
    for (let i=0; i<len_anlz; i++) {
      const x = calc_x(i);
      const w = calc_x(i+1) - x;
      if (x+w - prev >= 4) {
        idx ++;
        xs.push(prev);
        prev = x+w;
      }
    }
    xs.push(cv.width);
    return [idx,xs];
  }
  const update_buf_freq_log = () => {
    let prev = 0;
    let sum_amp = 0;
    let sum_len = 0;
    let idx = 0;
    for(let i=0; i<len_anlz; i++) {
      const v = buf_freq[i];
      const x = calc_x(i);
      const w = calc_x(i+1) - x;
      if (x+w - prev < 4) {
        // too close to the previous freq component; skip
        sum_len ++;
        sum_amp += v;
      } else {
        buf_freq_log[idx] = (sum_amp + v) / (sum_len + 1);
        idx ++;
        prev = x+w;
        sum_len = 0;
        sum_amp = 0;
      }
    }
  }

  // used for logarithmic analyzer
  const [len_anlz_log, pos] = calc_len_log(len_anlz);
  const buf_freq_log = new Float32Array(len_anlz_log);

  // used for modules
  const size_module = ~~(32 * cv.width / 800);
  const light =
    modules.length >= 255 ? 0.1
    : modules.length >= 128 ? 0.12
    : modules.length >= 64 ? 0.145
    : modules.length >= 32 ? 0.155 : 0.175;

  // used for progression bar
  const len_song = svlib._sv_get_song_length_lines(0);

  // define main loop function
  let cnt = 0;
  const loop = () => {
    // stop old loop
    if (idx_latest_instance !== idx_instance) return;

    // analyze
    anlz.getFloatTimeDomainData(buf_time);
    anlz.getFloatFrequencyData(buf_freq);

    // cv
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx_rot.clearRect(-cv_rot.width, -cv_rot.height, cv_rot.width*3, cv_rot.height*3);
    ctx.fillStyle = `#000`;
    ctx.fillRect(0, 0, cv.width, cv.height)

    // amp -> db
    const db_min = Math.max(anlz.minDecibels, -80),
          db_max = anlz.maxDecibels;
    for(let i=0; i<len_anlz; i++) {
      buf_freq[i] = Math.min(1, Math.max(0, (buf_freq[i] - db_min) / (db_max - db_min)));
    }

    // calculate a valute that moderately reflects volume
    const volume_moderate = Math.log(Math.abs(buf_time.reduce((u,v)=>u+v)/len_anlz)/4+1);

    // logarithmic calculation
    update_buf_freq_log();

    // render modules
    modules.forEach((m,_i) => {
      ctx_rot.fillStyle = `rgba(${m.r},${m.g},${m.b},${light + Math.min(2*volume_moderate, 0.1)})`;
      ctx_rot.fillRect(
        cv_rot.width/2  + m.p.x * cv_rot.width/2  - size_module/2,
        cv_rot.height/2 + m.p.y * cv_rot.height/2 - size_module/2,
        size_module,
        size_module
      )
    });
    ctx_rot.translate(cv_rot.width/2, cv_rot.height/2);
    ctx_rot.rotate(1/360/6 * Math.PI);
    ctx_rot.translate(-cv_rot.width/2, -cv_rot.height/2);

    ctx.drawImage(cv_rot, 0, 0);

    // lines
    ctx.strokeStyle = `hsl(${
      ~~((cnt%360) / 2 + 180) % 360
    },90%,80%,0.1)`;
    for(let j=1; j<=10; j++) {
      const rand = ((Math.random()-0.5)*0.125)+0.5;
      const span = cv.width / len_anlz;
      ctx.beginPath();
      ctx.moveTo(0, (buf_time[0]*rand+1)/2 * cv.height);
      for(let i=0; i<len_anlz-1; i++) {
        if (Math.abs(buf_time[i+1]) < no_signal) continue;
        ctx.lineTo(span*(i+1), (buf_time[i+1]*rand+1)/2 * cv.height);
      }
      ctx.stroke();
    }

    // bars in the bottom
    for(let i=0; i<len_anlz_log; i++) {
      if (buf_freq_log[i] < no_signal) continue;
      ctx.fillStyle = `hsla(${cnt%360 + i*60/len_anlz_log},60%,80%,0.8)`;
      ctx.fillRect(pos[i], cv.height * (1 - buf_freq_log[i]), pos[i+1]-pos[i], cv.height * buf_freq_log[i]);

      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.strokeRect(pos[i], cv.height * (1 - buf_freq_log[i]), pos[i+1]-pos[i], cv.height * buf_freq_log[i]);
    }

    // amount of bass
    const bass_power =
      Math.pow(2, buf_freq_log.filter((_,i) => i<=2).map((v,i)=>v/3*(1-0.0*i)).reduce((u,v)=>u+v)) - 1;

    // threshold for some effect
    const bass_power_threshold = 0.91

    // circle
    const r = (cv.height / 6) * (1+bass_power*0.5);
    const rd = r*1.1;

    // bars around circle
    {
      const cx = cv.width/2  + (Math.random()-0.5)*cv.width/36  * (bass_power >= bass_power_threshold ? bass_power : bass_power / 6),
            cy = cv.height/2 + (Math.random()-0.5)*cv.height/36 * (bass_power >= bass_power_threshold ? bass_power : bass_power / 6);
      const amp = v => Math.pow(v, 1.2) * rd * 2/3;
      const rot = -0.2;
      ctx.fillStyle="hsla(240,60%,90%,0.8)";

      for(let i=0; i<len_anlz_log; i++) {
        if (buf_freq_log[i] < no_signal) continue;
        for (let j=-1; j<=1; j++) {
          const [p,q] = [
            pos[i]   / cv.width,
            pos[i+1] / cv.width,
          ];
          const
            [px,py] = circle(rd, p/2*j+rot, cx, cy),
            [qx,qy] = circle(rd, q/2*j+rot, cx, cy),
            [wx,wy] = circle(amp(buf_freq_log[i]), (p+q)/2/2*j+rot);

          ctx.beginPath();
          ctx.moveTo(qx,qy);
          ctx.lineTo(px,py);
          ctx.lineTo(px+wx,py+wy);
          ctx.lineTo(qx+wx,qy+wy);
          ctx.closePath();
          ctx.fill();
        }
      }

      // circle
      ctx.fillStyle = `hsla(${cnt%360},90%,90%,1.0)`;
      ctx.beginPath();
      ctx.arc(cx, cy, rd, 0, 2*Math.PI)
      ctx.fill();

      const grad = ctx.createRadialGradient(cx, cy, r*0.975, cx, cy, r);
      grad.addColorStop(0, `hsla(${cnt%360},20%,10%,1.0)`);
      grad.addColorStop(1, `hsla(${cnt%360},85%,90%,1.0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2*Math.PI)
      ctx.fill();

      // logo
      ctx.drawImage(img_logo,
        0, 0, img_logo.width, img_logo.height,
        cx - r, cy - r, 2*r, 2*r
      );
    }

    // text
    {
      let font_size = ~~(24 * cv.width / 800);
      let x_text = cv.width - name_song.length * font_size;
      if (x_text < 0) {
        x_text = 0;
        font_size = ~~((cv.width) / name_song.length);
      }
      ctx.font = `${~~(font_size)}px 'Share Tech Mono'`;
      ctx.fillStyle = `#fff`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(name_song, cv.width - 16, 16);
    }

    // show progression
    {
      const size = ~~(16 * cv.width / 800);
      ctx.strokeStyle = `#fff`;
      ctx.strokeRect(16, cv.height - 16 - size, size * 8, size);
      ctx.fillStyle = `#fff`;
      ctx.fillRect(16, cv.height - 16 - size,
        size * 8 * svlib._sv_get_current_line(0) / len_song,
        size
      );
    }

    // // chromatic aberration effect (cpu hungry)
    // if (bass_power >= bass_power_threshold) {
    //   const img_drawn = ctx.getImageData(0, 0, cv.width, cv.height);
    //   const data = img_drawn.data;
    //   const power = ~~(bass_power * 4 * 5) - ~~(bass_power * 4 * 5)%4;
    //   for (let i = 0; i < data.length; i += 4) {
    //     if (i+power < data.length
    //       && (~~(~~((i+power)/4) * 4 * 5))%cv.width > ~~(16 * cv.width / 800)) data[i] = data[i+power];
    //   }
    //   ctx.putImageData(img_drawn, 0, 0);
    // }

    cnt ++;
    cnt = cnt % (360 * 32);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// handlers
document.addEventListener("DOMContentLoaded", () => {
  const cv = document.getElementById("main");
  let svlib = null;

  document.getElementById("demo").addEventListener("click", async e => {
    e.preventDefault();

    // finalize old instance
    if (svlib !== null) {
      window.svlib = svlib;
      svlib._sv_close_slot(0);
      svlib._sv_deinit();
    }

    // new instance
    svlib = await init(cv, await (await fetch("sk0 - Spring Rider.sunvox")).blob());
  });

  // resize
  const bg = document.getElementById("background");
  const resize = () => {
    const width = document.documentElement.clientWidth;
    cv.style.width = `${width}px`;
    cv.style.height = "auto";
    bg.style.width = `${width}px`;
    bg.style.height = "auto";
  };
  resize();
  window.addEventListener("resize", resize);

  // drag & drop
  cv.addEventListener('dragover', function(e) {
    e.stopPropagation();
    e.preventDefault();
    if (svlib === null) this.style.background = "rgba(0,255,0,0.4)";
  });

  cv.addEventListener('dragleave', function(e) {
    e.stopPropagation();
    e.preventDefault();
    if (svlib === null) this.style.background = "none";
  });

  cv.addEventListener("drop", async e => {
    e.stopPropagation();
    e.preventDefault();

    // accept single file only
    if (!e.dataTransfer.items) return;
    if (e.dataTransfer.files.length > 1) {
      alert("too many files!");
      return;
    }

    // finalize old instance
    if (svlib !== null) {
      window.svlib = svlib;
      svlib._sv_close_slot(0);
      svlib._sv_deinit();
    }

    // new instance
    svlib = await init(cv, e.dataTransfer.files[0]);
  });
});








