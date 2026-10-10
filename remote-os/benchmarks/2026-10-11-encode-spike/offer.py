import sys, gi
gi.require_version('Gst', '1.0'); gi.require_version('GstWebRTC', '1.0'); gi.require_version('GstSdp', '1.0')
from gi.repository import Gst, GstWebRTC, GstSdp, GLib
Gst.init(None)
src = sys.argv[1] if len(sys.argv) > 1 else 'videotestsrc is-live=true'
p = Gst.parse_launch(src + ' ! videoconvert ! video/x-raw,format=I420 ! queue max-size-buffers=2 leaky=downstream ! '
    'x264enc tune=zerolatency speed-preset=ultrafast key-int-max=60 bframes=0 bitrate=2500 ! video/x-h264,profile=constrained-baseline ! '
    'rtph264pay config-interval=-1 aggregate-mode=zero-latency ! application/x-rtp,media=video,encoding-name=H264,payload=96,clock-rate=90000 ! '
    'webrtcbin name=w bundle-policy=max-bundle stun-server=stun://stun.l.google.com:19302')
w = p.get_by_name('w')
loop = GLib.MainLoop()
state = {'cands': 0}
def on_cand(_w, mline, cand):
    state['cands'] += 1
    print('ICE candidate', mline, cand)
def on_offer(promise, _):
    reply = promise.get_reply()
    offer = reply.get_value('offer')
    sdp = offer.sdp.as_text()
    print('=== SDP OFFER ===\n' + sdp)
    w.emit('set-local-description', offer, Gst.Promise.new())
    ok = 'H264/90000' in sdp
    print('H264/90000 present:', ok)
    GLib.timeout_add(3000, lambda: (print('candidates gathered:', state['cands']), loop.quit()))
def on_nego(_w):
    w.emit('create-offer', None, Gst.Promise.new_with_change_func(on_offer, None))
w.connect('on-negotiation-needed', on_nego)
w.connect('on-ice-candidate', on_cand)
p.set_state(Gst.State.PLAYING)
GLib.timeout_add(15000, loop.quit)
loop.run()
p.set_state(Gst.State.NULL)
