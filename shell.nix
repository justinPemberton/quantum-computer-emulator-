{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  packages = [
    pkgs.gcc
    pkgs.gnumake
    pkgs.nodejs_20
  ];
}

