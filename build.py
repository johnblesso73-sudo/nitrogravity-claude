# Assembles src/ into a single-file index.html
head=open('src/head.html').read(); sim=open('src/sim.js').read(); app=open('src/app.js').read(); ag=open('src/agency.js').read()
out=head+'\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script>\n' +sim+'\n</script>\n<script>\n'+ag+'\n</script>\n<script>\n'+app+'\n</script>\n'
open('index.html','w').write(out)
