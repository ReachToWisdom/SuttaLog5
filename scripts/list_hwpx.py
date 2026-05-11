import zipfile
import sys

path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    for name in z.namelist():
        print(name)
