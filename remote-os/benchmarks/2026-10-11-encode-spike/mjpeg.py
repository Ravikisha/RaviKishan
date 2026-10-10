import sys, os, time, json, subprocess, threading
disp, size, scale, dur, label = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
cmd = ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-f','x11grab','-draw_mouse','1','-framerate','8','-video_size',size,'-i',disp,
       '-vf',f'mpdecimate,scale={scale}','-c:v','mjpeg','-q:v','10','-f','image2pipe','-']
pr = subprocess.Popen(cmd, stdout=subprocess.PIPE)
st = {'bytes':0,'frames':0,'measuring':False,'tail':b''}
def rd():
    while True:
        d = pr.stdout.read1(65536) if hasattr(pr.stdout,'read1') else pr.stdout.read(65536)
        if not d: break
        if st['measuring']:
            st['bytes'] += len(d); buf = st['tail'] + d; st['frames'] += buf.count(b'\xff\xd8\xff'); st['tail'] = buf[-2:]
threading.Thread(target=rd, daemon=True).start()
def cpu(pid):
    f = open(f'/proc/{pid}/stat').read().rsplit(')',1)[1].split(); return (int(f[11])+int(f[12]))/os.sysconf('SC_CLK_TCK')
def rss(pid):
    for l in open(f'/proc/{pid}/status'):
        if l.startswith('VmRSS'): return int(l.split()[1])//1024
time.sleep(2); st['measuring']=True; t0=time.monotonic(); c0=cpu(pr.pid)
time.sleep(dur); wall=time.monotonic()-t0; c=cpu(pr.pid)-c0; r=rss(pr.pid); st['measuring']=False
pr.terminate(); pr.wait()
print('RESULT '+json.dumps(dict(label=label, disp=disp, src=size, out=scale, out_fps=round(st['frames']/wall,2), cpu_pct_1core=round(100*c/wall,1),
      rss_mb=r, mbit_s=round(st['bytes']*8/wall/1e6,3), kbyte_s=round(st['bytes']/wall/1024,1))), flush=True)
