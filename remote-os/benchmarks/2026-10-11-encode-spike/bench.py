import sys, os, time, json, gi, collections
gi.require_version('Gst','1.0')
from gi.repository import Gst, GLib
Gst.init(None)
disp, W, H, F, B, preset, dur, label = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6], float(sys.argv[7]), sys.argv[8]
CONV = os.environ.get('CONV', 'videoscale ! video/x-raw,width={W},height={H} ! videoconvert ! video/x-raw,format=I420').format(W=W, H=H)
ENC = os.environ.get('ENC', 'x264enc name=enc tune=zerolatency speed-preset={preset} key-int-max=60 bframes=0 bitrate={B}').format(preset=preset, B=B)
desc = (f'ximagesrc name=src display-name={disp} use-damage=false show-pointer=true ! video/x-raw,framerate={F}/1 ! '
        f'{CONV} ! queue max-size-buffers=2 leaky=downstream ! {ENC} ! fakesink sync=false')
p = Gst.parse_launch(desc)
enc = p.get_by_name('enc'); src = p.get_by_name('src')
WARM = 2.0
st = {'in':collections.deque(), 'n':0, 'bytes':0, 'lat':[], 'cap':0, 't0':None, 'measuring':False}
def cap_probe(pad, info):
    if st['measuring']: st['cap'] += 1
    return Gst.PadProbeReturn.OK
def in_probe(pad, info):
    st['in'].append(time.monotonic()); return Gst.PadProbeReturn.OK
def out_probe(pad, info):
    b = info.get_buffer(); now = time.monotonic()
    t = st['in'].popleft() if st['in'] else None
    if st['measuring']:
        st['n'] += 1; st['bytes'] += b.get_size()
        if t is not None: st['lat'].append((now - t) * 1000)
    return Gst.PadProbeReturn.OK
src.get_static_pad('src').add_probe(Gst.PadProbeType.BUFFER, cap_probe)
enc.get_static_pad('sink').add_probe(Gst.PadProbeType.BUFFER, in_probe)
enc.get_static_pad('src').add_probe(Gst.PadProbeType.BUFFER, out_probe)
def cpu_self():
    f = open('/proc/self/stat').read().rsplit(')',1)[1].split(); return (int(f[11]) + int(f[12])) / os.sysconf('SC_CLK_TCK')
def cpu_sys():
    f = list(map(int, open('/proc/stat').readline().split()[1:])); idle = f[3] + f[4]; return sum(f), idle
def status(k):
    for l in open('/proc/self/status'):
        if l.startswith(k): return int(l.split()[1]) // 1024
loop = GLib.MainLoop()
def start():
    st['measuring'] = True; st['t0'] = time.monotonic(); st['c0'] = cpu_self(); st['s0'] = cpu_sys(); return False
def stop():
    t1 = time.monotonic(); wall = t1 - st['t0']; c = cpu_self() - st['c0']; s1 = cpu_sys()
    tot = s1[0] - st['s0'][0]; idl = s1[1] - st['s0'][1]
    q = Gst.Query.new_latency(); lat_q = None
    if p.query(q): live, mn, mx = q.parse_latency(); lat_q = mn / 1e6
    L = sorted(st['lat']); pct = lambda x: round(L[min(len(L)-1, int(len(L)*x))], 2) if L else None
    r = dict(label=label, conv=os.environ.get('CONV','default'), enc=os.environ.get('ENC','default'), disp=disp, res=f'{W}x{H}', fps_target=F, bitrate_kbps=B, preset=preset, wall_s=round(wall,2),
             cap_fps=round(st['cap']/wall,2), enc_fps=round(st['n']/wall,2), cpu_pct_1core=round(100*c/wall,1),
             sys_cpu_pct_of_4=round(100*(tot-idl)/tot,1) if tot else None, rss_mb=status('VmRSS'), hwm_mb=status('VmHWM'),
             mbit_s=round(st['bytes']*8/wall/1e6,3), enc_lat_ms_p50=pct(0.5), enc_lat_ms_p95=pct(0.95), enc_lat_ms_max=round(L[-1],2) if L else None,
             pipeline_latency_query_ms=lat_q)
    print('RESULT ' + json.dumps(r), flush=True); loop.quit(); return False
bus = p.get_bus(); bus.add_signal_watch()
bus.connect('message::error', lambda b, m: (print('ERROR', m.parse_error()), loop.quit()))
p.set_state(Gst.State.PLAYING)
GLib.timeout_add(int(WARM*1000), start); GLib.timeout_add(int((WARM+dur)*1000), stop)
loop.run(); p.set_state(Gst.State.NULL)
