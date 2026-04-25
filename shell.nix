{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    pkgs.gcc
    pkgs.bash
    pkgs.coreutils
    pkgs.gnumake
  ];

  shellHook = ''
    echo "Dev shell loaded"
    echo "Node: $(node --version)"
    echo "GCC: $(gcc --version | head -n 1)"
  '';
}
