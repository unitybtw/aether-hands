#include <ApplicationServices/ApplicationServices.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    // Single Execution Mode
    if (argc == 3) {
        float x = atof(argv[1]);
        float y = atof(argv[2]);
        CGPoint pt = CGPointMake(x, y);
        CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, pt, kCGMouseButtonLeft);
        CGEventPost(kCGHIDEventTap, move);
        CFRelease(move);
        return 0;
    } else if (argc == 2 && strcmp(argv[1], "click") == 0) {
        CGEventRef event = CGEventCreate(NULL);
        CGPoint pt = CGEventGetLocation(event);
        CFRelease(event);
        
        CGEventRef clickDown = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, pt, kCGMouseButtonLeft);
        CGEventRef clickUp   = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, pt, kCGMouseButtonLeft);
        CGEventPost(kCGHIDEventTap, clickDown);
        usleep(10000); // 10ms
        CGEventPost(kCGHIDEventTap, clickUp);
        CFRelease(clickDown);
        CFRelease(clickUp);
        return 0;
    }

    // Daemon Mode (Read from STDIN for zero-latency)
    char buffer[256];
    while (fgets(buffer, sizeof(buffer), stdin) != NULL) {
        if (strncmp(buffer, "click", 5) == 0) {
            CGEventRef event = CGEventCreate(NULL);
            CGPoint pt = CGEventGetLocation(event);
            CFRelease(event);
            
            CGEventRef clickDown = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, pt, kCGMouseButtonLeft);
            CGEventRef clickUp   = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, pt, kCGMouseButtonLeft);
            CGEventPost(kCGHIDEventTap, clickDown);
            usleep(10000); 
            CGEventPost(kCGHIDEventTap, clickUp);
            CFRelease(clickDown);
            CFRelease(clickUp);
        } else {
            float x, y;
            if (sscanf(buffer, "%f %f", &x, &y) == 2) {
                CGPoint pt = CGPointMake(x, y);
                CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, pt, kCGMouseButtonLeft);
                CGEventPost(kCGHIDEventTap, move);
                CFRelease(move);
            }
        }
    }
    return 0;
}
