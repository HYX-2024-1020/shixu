"""Optional development fixture regeneration; Pillow 12.3.0, project-authored pixels."""
import hashlib,json
from pathlib import Path
from PIL import Image, __version__
root=Path(__file__).resolve().parent.parent/'server/reading/fixtures'
report={'generator':'Pillow '+__version__,'synthetic':True,'files':{}}
for poster in [False,True]:
 frames=[]
 for n in range(5):
  im=Image.new('RGBA',(11,7)); im.putdata([( (x*31+n*27)%256,(y*37+n*19)%256,(x+y+n*43)%256,255 if n%2==0 else (128 if (x+y)%3 else 0)) for y in range(7) for x in range(11)])
  frames.append(im)
 name='apng-poster.png' if poster else 'apng-animation.png'
 count=len(frames)-int(poster)
 frames[0].save(root/name,save_all=True,append_images=frames[1:],default_image=poster,loop=2,duration=[30,70,130,170,190][:count],disposal=[0,1,2,0,0][:count],blend=[0,1,1,0,0][:count])
 b=(root/name).read_bytes(); actual=[]
 with Image.open(root/name) as image:
  for i in range(image.n_frames):
   image.seek(i); rgba=image.convert('RGBA');white=Image.new('RGBA',rgba.size,'white'); white.alpha_composite(rgba)
   actual.append({'frame':i+1,'pixelsHash':hashlib.sha256(white.tobytes()).hexdigest(),'delayMs':0 if poster and i==0 else image.info['duration']})
 report['files'][name]={'sha256':hashlib.sha256(b).hexdigest(),'frames':actual,'loops':2,'poster':poster}
(root/'apng-pillow-observed.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
