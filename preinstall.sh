function install {
  if ! command -v yarn &> /dev/null
  then
    npm install
  else
    yarn install
  fi
}
cd create && install && cd ..
cd develop && install && cd ..
