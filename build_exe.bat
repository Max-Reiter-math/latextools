@echo off
rem Build dist\latextools.exe from the conda environment in environment.yml.
rem   conda env create -f environment.yml   (once)
rem   build_exe.bat
call conda activate latextools
pyinstaller --noconfirm --onefile --windowed --name latextools ^
  --paths . --add-data "docs;docs" latextools\desktop.py
