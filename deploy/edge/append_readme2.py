import base64
content = base64.b64decode("test").decode()
with open("/Users/devtran/Downloads/JOHNTRAN-JS/deploy/edge/README.md", "a") as f:
    f.write(content)
print("done")
