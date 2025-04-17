---
title: Migrating from PHPUnit
description: Migrating from PHPUnit to Pest is a simple process that can be completed in just a few steps.
---

# Migrating from PHPUnit

Pest is built on top of PHPUnit, so migrating from PHPUnit to Pest is a simple process that can be completed in just a few steps. Once you have Pest installed, you should require the `pestphp/pest-plugin-drift` package as a "dev" dependency in your project.

```bash
composer require pestphp/pest-plugin-drift --dev
```

Drift is a simple yet powerful plugin that will automatically convert your PHPUnit tests to Pest, simply by running the `--drift` option.

```bash
./vendor/bin/pest --drift
```

So, typically, a PHPUnit test looks like this:

```php
<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class ExampleTest extends TestCase
{
    public function test_that_true_is_true(): void
    {
        $this->assertTrue(true);
    }
}
```

Should look like this after running `--drift`:

```php
test('true is true', function () {
    expect(true)->toBeTrue();
});
```

---
## Convert Phpunit tests only for certain folder

If you want to convert Phpunit tests only for certain folder, you can pass _path_ as first argument when calling `--drift`:

Example call, if you want to run the conversion for folder `/tests/Helpers`: 
```console 
/vendor/bin/pest --drift tests/Helpers
```

Output:
```console
/vendor/bin/pest --drift tests/Helpers

✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔✔

INFO  The [tests/Helpers] directory has been migrated to PEST with XY files changed.
```

---

The output will contain a summary of the conversion process, as well as a list of the files that were converted.

While most of your tests should be converted automatically, and you should be able to run them without any issues, there are some cases where you may need to manually convert some of your tests.

---

Of course, this particular chapter is only for those who are migrating from PHPUnit. Next, let's learn how you can contribute to the growth of Pest: [Community Guide](/docs/community-guide)
