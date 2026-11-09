#include "lwip/opt.h"
#include "lwip/sys.h"

#ifdef _WIN32
  // defines both win32 and win64
  #ifdef _MSC_VER
  #pragma warning (push, 3)
  #endif
  #include <windows.h>
  #ifdef _MSC_VER
  #pragma warning (pop)
  #endif
  #include <time.h>
  
  #include <lwip/arch.h>
  #include <lwip/stats.h>
  #include <lwip/debug.h>
  #include <lwip/tcpip.h>
  
  /** Set this to 1 to enable assertion checks that SYS_ARCH_PROTECT() is only
   * called once in a call stack (calling it nested might cause trouble in some
   * implementations, so let's avoid this in core code as long as we can).
   */
  #ifndef LWIP_SYS_ARCH_CHECK_NESTED_PROTECT
  #define LWIP_SYS_ARCH_CHECK_NESTED_PROTECT 1
  #endif
  
  /** Set this to 1 to enable assertion checks that SYS_ARCH_PROTECT() is *not*
   * called before functions potentiolly involving the OS scheduler.
   *
   * This scheme is currently broken only for non-core-locking when waking up
   * threads waiting on a socket via select/poll.
   */
  #ifndef LWIP_SYS_ARCH_CHECK_SCHEDULING_UNPROTECTED
  #define LWIP_SYS_ARCH_CHECK_SCHEDULING_UNPROTECTED LWIP_TCPIP_CORE_LOCKING
  #endif
  
  #define LWIP_WIN32_SYS_ARCH_ENABLE_PROTECT_COUNTER (LWIP_SYS_ARCH_CHECK_NESTED_PROTECT || LWIP_SYS_ARCH_CHECK_SCHEDULING_UNPROTECTED)
  
  /* These functions are used from NO_SYS also, for precise timer triggering */
  static LARGE_INTEGER freq, sys_start_time;
  #define SYS_INITIALIZED() (freq.QuadPart != 0)
  
  static DWORD netconn_sem_tls_index;
  
  static HCRYPTPROV hcrypt;
  
  u32_t
  sys_win_rand(void)
  {
    u32_t ret;
    if (CryptGenRandom(hcrypt, sizeof(ret), (BYTE*)&ret)) {
      return ret;
    }
    LWIP_ASSERT("CryptGenRandom failed", 0);
    return 0;
  }
  
  static void
  sys_win_rand_init(void)
  {
    if (!CryptAcquireContext(&hcrypt, NULL, NULL, PROV_RSA_FULL, 0)) {
      DWORD err = GetLastError();
      LWIP_PLATFORM_DIAG(("CryptAcquireContext failed with error %d, trying to create NEWKEYSET", (int)err));
      if(!CryptAcquireContext(&hcrypt, NULL, NULL, PROV_RSA_FULL, CRYPT_NEWKEYSET)) {
        char errbuf[128];
        err = GetLastError();
        snprintf(errbuf, sizeof(errbuf), "CryptAcquireContext failed with error %d", (int)err);
        LWIP_UNUSED_ARG(err);
        LWIP_ASSERT(errbuf, 0);
      }
    }
  }
  
  static void
  sys_init_timing(void)
  {
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&sys_start_time);
  }
  
  static LONGLONG
  sys_get_ms_longlong(void)
  {
    LONGLONG ret;
    LARGE_INTEGER now;
  #if NO_SYS
    if (!SYS_INITIALIZED()) {
      sys_init();
      LWIP_ASSERT("initialization failed", SYS_INITIALIZED());
    }
  #endif /* NO_SYS */
    QueryPerformanceCounter(&now);
    ret = now.QuadPart-sys_start_time.QuadPart;
    return (u32_t)(((ret)*1000)/freq.QuadPart);
  }
  
  u32_t
  sys_jiffies(void)
  {
    return (u32_t)sys_get_ms_longlong();
  }
  
  u32_t
  sys_now(void)
  {
    return (u32_t)sys_get_ms_longlong();
  }
  
  CRITICAL_SECTION critSec;
  #if LWIP_WIN32_SYS_ARCH_ENABLE_PROTECT_COUNTER
  static int protection_depth;
  #endif
  
  static void
  InitSysArchProtect(void)
  {
    InitializeCriticalSection(&critSec);
  }
  
  sys_prot_t
  sys_arch_protect(void)
  {
  #if NO_SYS
    if (!SYS_INITIALIZED()) {
      sys_init();
      LWIP_ASSERT("initialization failed", SYS_INITIALIZED());
    }
  #endif
    EnterCriticalSection(&critSec);
  #if LWIP_SYS_ARCH_CHECK_NESTED_PROTECT
    LWIP_ASSERT("nested SYS_ARCH_PROTECT", protection_depth == 0);
  #endif
  #if LWIP_WIN32_SYS_ARCH_ENABLE_PROTECT_COUNTER
    protection_depth++;
  #endif
    return 0;
  }
  
  void
  sys_arch_unprotect(sys_prot_t pval)
  {
    LWIP_UNUSED_ARG(pval);
  #if LWIP_SYS_ARCH_CHECK_NESTED_PROTECT
    LWIP_ASSERT("missing SYS_ARCH_PROTECT", protection_depth == 1);
  #else
    LWIP_ASSERT("missing SYS_ARCH_PROTECT", protection_depth > 0);
  #endif
  #if LWIP_WIN32_SYS_ARCH_ENABLE_PROTECT_COUNTER
    protection_depth--;
  #endif
    LeaveCriticalSection(&critSec);
  }
  
  #if LWIP_SYS_ARCH_CHECK_SCHEDULING_UNPROTECTED
  /** This checks that SYS_ARCH_PROTECT() hasn't been called by protecting
   * and then checking the level
   */
  static void
  sys_arch_check_not_protected(void)
  {
    sys_arch_protect();
    LWIP_ASSERT("SYS_ARCH_PROTECT before scheduling", protection_depth == 1);
    sys_arch_unprotect(0);
  }
  #else
  #define sys_arch_check_not_protected()
  #endif
  
  static void
  msvc_sys_init(void)
  {
    sys_win_rand_init();
    sys_init_timing();
    InitSysArchProtect();
    netconn_sem_tls_index = TlsAlloc();
    LWIP_ASSERT("TlsAlloc failed", netconn_sem_tls_index != TLS_OUT_OF_INDEXES);
  }
  
  void
  sys_init(void)
  {
    msvc_sys_init();
  }

  #include <stdarg.h>
  
  /* This is an example implementation for LWIP_PLATFORM_DIAG:
   * format a string and pass it to your output function.
   */
  void
  lwip_win32_platform_diag(const char *format, ...)
  {
    va_list ap;
    /* get the varargs */
    va_start(ap, format);
    /* print via varargs; to use another output function, you could use
       vsnprintf here */
    vprintf(format, ap);
    va_end(ap);
  }
#elif __APPLE__
    #include <mach/mach_time.h>
    u32_t sys_now(void) {
        uint64_t now = mach_absolute_time();
        mach_timebase_info_data_t info;
        mach_timebase_info(&info);
        now = now * info.numer / info.denom / NSEC_PER_MSEC;
        return (u32_t)(now);
    }
#elif __linux
    #include <sys/time.h>
    u32_t sys_now(void)
    {
        struct timeval te;
        gettimeofday(&te, NULL);
        return te.tv_sec*1000LL + te.tv_usec/1000;
    }
#elif __unix // all unices not caught above
    // Unix
#elif __posix
    // POSIX
#endif
