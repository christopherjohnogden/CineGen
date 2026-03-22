{
  "targets": [
    {
      "target_name": "cinegen_avfoundation",
      "sources": ["src/cinegen_avfoundation.mm"],
      "include_dirs": ["../../node_modules/node-addon-api"],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS=1"],
      "cflags_cc": ["-std=c++20"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "CLANG_CXX_LIBRARY": "libc++",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_LDFLAGS": [
          "-framework", "Cocoa",
          "-framework", "AVFoundation",
          "-framework", "QuartzCore",
          "-framework", "CoreMedia"
        ]
      }
    }
  ]
}
