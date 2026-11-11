import base64
p="core/music/command.js"
d=open(p,"rb").read()
old=b"dung \\`out\\`."
new=b"dung `out`."
assert old in d, "not found"
d=d.replace(old,new)
open(p,"wb").write(d)
print("done")
