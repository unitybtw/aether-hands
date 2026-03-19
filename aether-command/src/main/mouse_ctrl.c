#include <ApplicationServices/ApplicationServices.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char *argv[]) {
    if (argc == 3) {
        float x = atof(argv[1]);
        float y = atof(argv[2]);
        CGPoint pt = CGPointMake(x, y);
        CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, pt, kCGMouseButtonLeft);
        CGEventPost(kCGHIDEventTap, move);
        CFRelease(move);
    } else if (argc == 2 && strcmp(argv[1], "click") == 0) {
        CGEventRef event = CGEventCreate(NULL);
        CGPoint pt = CGEventGetLocation(event);
        CFRelease(event);
        
        CGEventRef clickDown = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, pt, kCGMouseButtonLeft);
        CGEventRef clickUp   = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, pt, kCGMouseButtonLeft);
        CGEventPost(kCGHIDEventTap, clickDown);
        usleep(10000); // 10ms wait for safety
        CGEventPost(kCGHIDEventTap, clickUp);
        CFRelease(clickDown);
        CFRelease(clickUp);
    }
    return 0;
}
